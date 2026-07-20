import { createHash } from 'node:crypto';
import {
  LABEL_TRASH_RETENTION_MS,
  MAX_LABEL_REPORTS,
  createLabelPreviewUrl,
  createLabelTemplateTombstone,
  normalizeFingerprintList,
  normalizeModerationStatus,
  normalizeReportReason,
  validateLabelTemplateSnapshot,
} from './helix-label-domain.mjs';
import {
  createHelixDatabase,
  getHelixDatabaseOverride,
} from './helix-database-runtime.mjs';

let cachedDatabase;
let cachedConnectionString;

export function getLabelDatabase() {
  const connectionString = getHelixDatabaseOverride();

  if (!cachedDatabase || connectionString !== cachedConnectionString) {
    cachedConnectionString = connectionString;
    cachedDatabase = createHelixDatabase(connectionString);
  }

  return cachedDatabase;
}

export function resetLabelDatabaseClientForTests() {
  cachedDatabase = undefined;
  cachedConnectionString = undefined;
}

export async function closeLabelDatabaseClientForTests() {
  const database = cachedDatabase;

  resetLabelDatabaseClientForTests();
  await database?.pool?.end();
}

export async function getPostgresLabelHealth() {
  const database = getLabelDatabase();
  const [row] = await database.sql`SELECT NOW() AS checked_at`;

  return {
    ok: true,
    checkedAt: toIsoString(row?.checked_at) ?? new Date().toISOString(),
  };
}

export async function readPostgresLabelTemplates({ includeExpired = false } = {}) {
  const database = getLabelDatabase();
  const cutoff = new Date(Date.now() - LABEL_TRASH_RETENTION_MS).toISOString();
  const labels = includeExpired
    ? await database.sql`SELECT * FROM label_templates ORDER BY created_at DESC, id ASC`
    : await database.sql`
        SELECT *
        FROM label_templates
        WHERE deleted_at IS NULL OR deleted_at > ${cutoff}
        ORDER BY created_at DESC, id ASC
      `;
  const [categories, tags, votes, reports] = await Promise.all([
    database.sql`SELECT label_id, category, ordinal FROM label_template_categories ORDER BY label_id, ordinal`,
    database.sql`SELECT label_id, tag, ordinal FROM label_template_tags ORDER BY label_id, ordinal`,
    database.sql`SELECT label_id, fingerprint, ordinal FROM label_votes ORDER BY label_id, ordinal, fingerprint`,
    database.sql`
      SELECT
        label_id,
        fingerprint,
        reason,
        details,
        created_at,
        include_in_reports,
        include_in_fingerprints,
        report_ordinal,
        fingerprint_ordinal
      FROM label_reports
      ORDER BY label_id, created_at, fingerprint
    `,
  ]);
  const categoriesByLabel = groupRows(categories, 'label_id');
  const tagsByLabel = groupRows(tags, 'label_id');
  const votesByLabel = groupRows(votes, 'label_id');
  const reportsByLabel = groupRows(reports, 'label_id');

  return labels.map((row) => toLabelTemplate(row, {
    categories: categoriesByLabel.get(row.id) ?? [],
    tags: tagsByLabel.get(row.id) ?? [],
    votes: votesByLabel.get(row.id) ?? [],
    reports: reportsByLabel.get(row.id) ?? [],
  }));
}

export async function readPostgresLabelTemplate(itemId, options = {}) {
  const labels = await readPostgresLabelTemplates(options);

  return labels.find((item) => item.id === itemId);
}

export async function upsertPostgresLabelSnapshot(item, { force = false } = {}) {
  const validation = validateLabelTemplateSnapshot(item);

  if (!validation.ok) {
    return {
      status: 'blocked',
      id: item?.id,
      reason: validation.reason,
    };
  }

  const database = getLabelDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await purgeExpiredLabels(client);
    const currentResult = await client.query(
      'SELECT updated_at FROM label_templates WHERE id = $1 FOR UPDATE',
      [item.id],
    );
    const currentUpdatedAt = currentResult.rows[0]?.updated_at;
    const incomingUpdatedAt = parseRequiredTimestamp(item.updatedAt, 'updatedAt');

    if (
      currentUpdatedAt &&
      !force &&
      new Date(currentUpdatedAt).getTime() > incomingUpdatedAt.getTime()
    ) {
      await client.query('ROLLBACK');
      return { status: 'skipped-newer', id: item.id };
    }

    const wasWritten = await writeLabelSnapshot(client, item, { force });

    if (!wasWritten) {
      await client.query('COMMIT');
      return { status: 'skipped-newer', id: item.id };
    }

    await client.query('COMMIT');

    return {
      status: currentResult.rowCount ? 'updated' : 'inserted',
      id: item.id,
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresLabelTemplate(itemId, now = new Date().toISOString()) {
  const database = getLabelDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await purgeExpiredLabels(client);
    const result = await client.query('DELETE FROM label_templates WHERE id = $1 RETURNING id', [itemId]);

    if (!result.rowCount) {
      throw createPostgresLabelError(404, 'Label template not found.');
    }

    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }

  return createLabelTemplateTombstone(itemId, now);
}

export async function votePostgresLabelTemplate({ itemId, fingerprint, direction, now }) {
  const database = getLabelDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await purgeExpiredLabels(client);
    await lockExistingLabel(client, itemId);

    if (direction === 1) {
      await client.query(
        `INSERT INTO label_votes (label_id, fingerprint, ordinal, created_at)
         VALUES (
           $1,
           $2,
           COALESCE((SELECT MAX(ordinal) + 1 FROM label_votes WHERE label_id = $1), 0),
           $3
         )
         ON CONFLICT (label_id, fingerprint) DO NOTHING`,
        [itemId, fingerprint, now],
      );
    } else {
      await client.query(
        'DELETE FROM label_votes WHERE label_id = $1 AND fingerprint = $2',
        [itemId, fingerprint],
      );
    }

    const countResult = await client.query(
      'SELECT COUNT(*)::INTEGER AS count FROM label_votes WHERE label_id = $1',
      [itemId],
    );
    await client.query(
      'UPDATE label_templates SET vote_count = $2, updated_at = $3 WHERE id = $1',
      [itemId, Number(countResult.rows[0]?.count) || 0, now],
    );
    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }

  return readPostgresLabelTemplate(itemId);
}

export async function reportPostgresLabelTemplate({ itemId, fingerprint, reason, details, now }) {
  const database = getLabelDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await purgeExpiredLabels(client);
    await lockExistingLabel(client, itemId);
    const insertResult = await client.query(
      `INSERT INTO label_reports (
         label_id,
         fingerprint,
         reason,
         details,
         created_at,
         include_in_reports,
         include_in_fingerprints,
         report_ordinal,
         fingerprint_ordinal
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         TRUE,
         TRUE,
         COALESCE((SELECT MAX(report_ordinal) + 1 FROM label_reports WHERE label_id = $1), 0),
         COALESCE((SELECT MAX(fingerprint_ordinal) + 1 FROM label_reports WHERE label_id = $1), 0)
       )
       ON CONFLICT (label_id, fingerprint) DO NOTHING
       RETURNING fingerprint`,
      [itemId, fingerprint, normalizeReportReason(reason) || 'other', details ?? '', now],
    );

    if (insertResult.rowCount) {
      await client.query(
        `DELETE FROM label_reports
         WHERE label_id = $1
           AND fingerprint IN (
             SELECT fingerprint
             FROM label_reports
             WHERE label_id = $1
             ORDER BY created_at DESC, report_ordinal DESC, fingerprint DESC
             OFFSET $2
           )`,
        [itemId, MAX_LABEL_REPORTS],
      );
      const countResult = await client.query(
        `SELECT COUNT(*)::INTEGER AS count
         FROM label_reports
         WHERE label_id = $1 AND include_in_fingerprints = TRUE`,
        [itemId],
      );
      await client.query(
        'UPDATE label_templates SET report_count = $2, updated_at = $3 WHERE id = $1',
        [itemId, Number(countResult.rows[0]?.count) || 0, now],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }

  return readPostgresLabelTemplate(itemId);
}

export async function adminUpdatePostgresLabelTemplate(item, { clearReports = false } = {}) {
  const validation = validateLabelTemplateSnapshot(item);

  if (!validation.ok) {
    throw createPostgresLabelError(400, validation.reason);
  }

  const database = getLabelDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await purgeExpiredLabels(client);
    await lockExistingLabel(client, item.id);
    await client.query(
      `UPDATE label_templates SET
         preview_asset_key = $2,
         preview_mime_type = $3,
         preview_file_name = $4,
         preview_byte_length = $5,
         niimbot_code = $6,
         template_name = $7,
         peptide_name = $8,
         mass_mg = $9,
         label_size = $10,
         moderation_status = $11,
         deleted_at = $12,
         deleted_reason = $13,
         updated_at = $14
       WHERE id = $1`,
      labelRowParameters(item),
    );
    await replaceOrderedValues(client, 'label_template_categories', 'category', item.id, item.peptideCategories);
    await replaceOrderedValues(client, 'label_template_tags', 'tag', item.id, item.tags);

    if (clearReports) {
      await client.query('DELETE FROM label_reports WHERE label_id = $1', [item.id]);
      await client.query('UPDATE label_templates SET report_count = 0 WHERE id = $1', [item.id]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }

  return readPostgresLabelTemplate(item.id);
}

export async function softDeletePostgresLabelTemplate(itemId, deletedReason, now = new Date().toISOString()) {
  const database = getLabelDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await purgeExpiredLabels(client);
    const result = await client.query(
      `UPDATE label_templates
       SET
         moderation_status = 'rejected',
         deleted_at = $2,
         deleted_reason = $3,
         updated_at = $2
       WHERE id = $1
       RETURNING id`,
      [itemId, now, deletedReason],
    );

    if (!result.rowCount) {
      throw createPostgresLabelError(404, 'Label template not found.');
    }

    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }

  return readPostgresLabelTemplate(itemId);
}

export async function recoverPostgresLabelTemplate(itemId, now = new Date().toISOString()) {
  const database = getLabelDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await purgeExpiredLabels(client);
    const result = await client.query(
      `UPDATE label_templates
       SET
         moderation_status = 'unreviewed',
         deleted_at = NULL,
         deleted_reason = NULL,
         updated_at = $2
       WHERE id = $1
       RETURNING id`,
      [itemId, now],
    );

    if (!result.rowCount) {
      throw createPostgresLabelError(404, 'Label template not found.');
    }

    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }

  return readPostgresLabelTemplate(itemId);
}

export async function deletePostgresLabelsNotIn(itemIds) {
  const database = getLabelDatabase();
  const client = await database.pool.connect();
  const ids = [...new Set(itemIds.filter((item) => typeof item === 'string' && item))];

  try {
    await client.query('BEGIN');
    const result = ids.length
      ? await client.query(
          'DELETE FROM label_templates WHERE NOT (id = ANY($1::TEXT[])) RETURNING id',
          [ids],
        )
      : await client.query('DELETE FROM label_templates RETURNING id');
    await client.query('COMMIT');

    return result.rows.map((row) => row.id);
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function recordPostgresLabelVerification(summary) {
  const database = getLabelDatabase();
  const [record] = await database.sql`
    INSERT INTO label_storage_verifications (
      operation,
      observation_reset,
      legacy_count,
      postgres_count,
      matched_count,
      missing_count,
      extra_count,
      different_count,
      is_exact,
      legacy_hash,
      postgres_hash,
      details
    ) VALUES (
      ${summary.operation ?? 'manual'},
      ${Boolean(summary.observationReset)},
      ${summary.legacyCount},
      ${summary.postgresCount},
      ${summary.matchedCount},
      ${summary.missingInPostgresIds.length},
      ${summary.extraInPostgresIds.length},
      ${summary.differentIds.length},
      ${summary.isExact},
      ${summary.legacyHash},
      ${summary.postgresHash},
      ${JSON.stringify({
        missingInPostgresIds: summary.missingInPostgresIds,
        extraInPostgresIds: summary.extraInPostgresIds,
        differentIds: summary.differentIds,
        blockedIds: summary.blockedIds ?? [],
      })}::JSONB
    )
    RETURNING *
  `;

  return toVerificationRecord(record);
}

export async function readLatestPostgresLabelVerification() {
  const database = getLabelDatabase();
  const [record] = await database.sql`
    SELECT *
    FROM label_storage_verifications
    ORDER BY checked_at DESC, id DESC
    LIMIT 1
  `;

  return record ? toVerificationRecord(record) : null;
}

export async function readPostgresLabelVerificationHistory({ days = 7 } = {}) {
  const database = getLabelDatabase();
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
  const records = await database.sql`
    SELECT *
    FROM label_storage_verifications
    WHERE checked_at >= ${since}
    ORDER BY checked_at ASC, id ASC
  `;

  return records.map(toVerificationRecord);
}

async function writeLabelSnapshot(client, item, { force }) {
  const createdAt = parseRequiredTimestamp(item.createdAt, 'createdAt').toISOString();
  const updatedAt = parseRequiredTimestamp(item.updatedAt, 'updatedAt').toISOString();
  const deletedAt = item.deletedAt ? parseRequiredTimestamp(item.deletedAt, 'deletedAt').toISOString() : null;
  const voteFingerprints = normalizeFingerprintList(item.voteFingerprints);
  const reportEntries = createReportEntries(item);

  const labelResult = await client.query(
    `INSERT INTO label_templates (
       id,
       preview_asset_key,
       preview_mime_type,
       preview_file_name,
       preview_byte_length,
       niimbot_code,
       template_name,
       peptide_name,
       mass_mg,
       label_size,
       moderation_status,
       vote_count,
       report_count,
       deleted_at,
       deleted_reason,
       created_at,
       updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
     )
     ON CONFLICT (id) DO UPDATE SET
       preview_asset_key = EXCLUDED.preview_asset_key,
       preview_mime_type = EXCLUDED.preview_mime_type,
       preview_file_name = EXCLUDED.preview_file_name,
       preview_byte_length = EXCLUDED.preview_byte_length,
       niimbot_code = EXCLUDED.niimbot_code,
       template_name = EXCLUDED.template_name,
       peptide_name = EXCLUDED.peptide_name,
       mass_mg = EXCLUDED.mass_mg,
       label_size = EXCLUDED.label_size,
       moderation_status = EXCLUDED.moderation_status,
       vote_count = EXCLUDED.vote_count,
       report_count = EXCLUDED.report_count,
       deleted_at = EXCLUDED.deleted_at,
       deleted_reason = EXCLUDED.deleted_reason,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at
     WHERE $18::BOOLEAN OR label_templates.updated_at <= EXCLUDED.updated_at`,
    [
      item.id,
      item.previewAssetKey,
      item.previewMimeType,
      item.previewFileName,
      Math.max(0, Math.round(Number(item.previewByteLength) || 0)),
      item.niimbotCode,
      typeof item.templateName === 'string' && item.templateName ? item.templateName : null,
      item.peptideName,
      item.massMg,
      item.labelSize,
      normalizeModerationStatus(item.moderationStatus),
      Math.max(voteFingerprints.length, Math.max(0, Math.round(Number(item.votes) || 0))),
      Math.max(0, Math.round(Number(item.reportCount) || 0)),
      deletedAt,
      deletedAt && ['admin', 'rejected'].includes(item.deletedReason) ? item.deletedReason : null,
      createdAt,
      updatedAt,
      Boolean(force),
    ],
  );

  if (!labelResult.rowCount) {
    return false;
  }

  await replaceOrderedValues(client, 'label_template_categories', 'category', item.id, item.peptideCategories);
  await replaceOrderedValues(client, 'label_template_tags', 'tag', item.id, item.tags);
  await client.query('DELETE FROM label_votes WHERE label_id = $1', [item.id]);

  for (const [ordinal, fingerprint] of voteFingerprints.entries()) {
    await client.query(
      `INSERT INTO label_votes (label_id, fingerprint, ordinal, created_at)
       VALUES ($1, $2, $3, $4)`,
      [item.id, fingerprint, ordinal, updatedAt],
    );
  }

  await client.query('DELETE FROM label_reports WHERE label_id = $1', [item.id]);

  for (const report of reportEntries) {
    await client.query(
      `INSERT INTO label_reports (
         label_id,
         fingerprint,
         reason,
         details,
         created_at,
         include_in_reports,
         include_in_fingerprints,
         report_ordinal,
         fingerprint_ordinal
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        item.id,
        report.fingerprint,
        report.reason,
        report.details,
        report.createdAt,
        report.includeInReports,
        report.includeInFingerprints,
        report.reportOrdinal,
        report.fingerprintOrdinal,
      ],
    );
  }

  return true;
}

async function replaceOrderedValues(client, tableName, valueColumn, labelId, values) {
  const safeTableNames = new Set(['label_template_categories', 'label_template_tags']);
  const safeValueColumns = new Set(['category', 'tag']);

  if (!safeTableNames.has(tableName) || !safeValueColumns.has(valueColumn)) {
    throw new Error('Invalid label relation table.');
  }

  await client.query(`DELETE FROM ${tableName} WHERE label_id = $1`, [labelId]);
  const normalizedValues = [...new Set(
    (Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value),
  )];

  for (const [ordinal, value] of normalizedValues.entries()) {
    await client.query(
      `INSERT INTO ${tableName} (label_id, ${valueColumn}, ordinal) VALUES ($1, $2, $3)`,
      [labelId, value, ordinal],
    );
  }
}

function createReportEntries(item) {
  const reports = Array.isArray(item.reports) ? item.reports : [];
  const fingerprints = normalizeFingerprintList(item.reportFingerprints);
  const entries = new Map();

  for (const [index, report] of reports.entries()) {
    const existingFingerprint = typeof report?.fingerprint === 'string' && report.fingerprint
      ? report.fingerprint
      : '';
    const fingerprint = existingFingerprint || createLegacyReportKey(item.id, index, report);
    entries.set(fingerprint, {
      fingerprint,
      reason: normalizeReportReason(report?.reason) || 'other',
      details: typeof report?.details === 'string' ? report.details : '',
      createdAt: isValidTimestamp(report?.createdAt) ? new Date(report.createdAt).toISOString() : item.updatedAt,
      includeInReports: true,
      includeInFingerprints: Boolean(existingFingerprint && fingerprints.includes(existingFingerprint)),
      reportOrdinal: index,
      fingerprintOrdinal: existingFingerprint && fingerprints.includes(existingFingerprint)
        ? fingerprints.indexOf(existingFingerprint)
        : null,
    });
  }

  for (const [index, fingerprint] of fingerprints.entries()) {
    const current = entries.get(fingerprint);

    if (current) {
      current.includeInFingerprints = true;
      current.fingerprintOrdinal = index;
      continue;
    }

    entries.set(fingerprint, {
      fingerprint,
      reason: 'other',
      details: '',
      createdAt: item.updatedAt,
      includeInReports: false,
      includeInFingerprints: true,
      reportOrdinal: null,
      fingerprintOrdinal: index,
    });
  }

  return [...entries.values()];
}

function createLegacyReportKey(labelId, index, report) {
  const digest = createHash('sha256')
    .update(JSON.stringify([labelId, index, report?.reason, report?.details, report?.createdAt]))
    .digest('hex')
    .slice(0, 32);

  return `legacy-report:${digest}`;
}

function toLabelTemplate(row, relations) {
  const reportRows = relations.reports;
  const item = {
    id: row.id,
    previewAssetKey: row.preview_asset_key,
    previewMimeType: row.preview_mime_type,
    previewFileName: row.preview_file_name,
    previewByteLength: Number(row.preview_byte_length) || 0,
    previewUrl: createLabelPreviewUrl(row.id),
    niimbotCode: row.niimbot_code,
    ...(row.template_name ? { templateName: row.template_name } : {}),
    peptideName: row.peptide_name,
    massMg: row.mass_mg,
    labelSize: row.label_size,
    peptideCategories: relations.categories.map((item) => item.category),
    tags: relations.tags.map((item) => item.tag),
    votes: Number(row.vote_count) || 0,
    voteFingerprints: relations.votes
      .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
      .map((item) => item.fingerprint),
    moderationStatus: normalizeModerationStatus(row.moderation_status),
    reportCount: Number(row.report_count) || 0,
    reports: reportRows
      .filter((item) => item.include_in_reports)
      .sort((left, right) => Number(left.report_ordinal) - Number(right.report_ordinal))
      .map((item) => ({
        reason: normalizeReportReason(item.reason) || 'other',
        details: item.details ?? '',
        ...(item.include_in_fingerprints ? { fingerprint: item.fingerprint } : {}),
        createdAt: toIsoString(item.created_at) ?? new Date().toISOString(),
      })),
    reportFingerprints: reportRows
      .filter((item) => item.include_in_fingerprints)
      .sort((left, right) => Number(left.fingerprint_ordinal) - Number(right.fingerprint_ordinal))
      .map((item) => item.fingerprint),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };

  if (row.deleted_at) {
    item.deletedAt = toIsoString(row.deleted_at);
    item.deletedReason = ['admin', 'rejected'].includes(row.deleted_reason)
      ? row.deleted_reason
      : item.moderationStatus === 'rejected' ? 'rejected' : 'admin';
  }

  return item;
}

function labelRowParameters(item) {
  return [
    item.id,
    item.previewAssetKey,
    item.previewMimeType,
    item.previewFileName,
    Math.max(0, Math.round(Number(item.previewByteLength) || 0)),
    item.niimbotCode,
    typeof item.templateName === 'string' && item.templateName ? item.templateName : null,
    item.peptideName,
    item.massMg,
    item.labelSize,
    normalizeModerationStatus(item.moderationStatus),
    item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
    item.deletedAt && ['admin', 'rejected'].includes(item.deletedReason) ? item.deletedReason : null,
    new Date(item.updatedAt).toISOString(),
  ];
}

async function lockExistingLabel(client, itemId) {
  const result = await client.query(
    'SELECT id FROM label_templates WHERE id = $1 FOR UPDATE',
    [itemId],
  );

  if (!result.rowCount) {
    throw createPostgresLabelError(404, 'Label template not found.');
  }
}

async function purgeExpiredLabels(client) {
  const cutoff = new Date(Date.now() - LABEL_TRASH_RETENTION_MS).toISOString();

  await client.query(
    'DELETE FROM label_templates WHERE deleted_at IS NOT NULL AND deleted_at <= $1',
    [cutoff],
  );
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original database error.
  }
}

function groupRows(rows, key) {
  const groups = new Map();

  for (const row of rows) {
    const value = row[key];
    const group = groups.get(value) ?? [];
    group.push(row);
    groups.set(value, group);
  }

  return groups;
}

function isValidTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseRequiredTimestamp(value, fieldName) {
  const timestamp = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);

  if (!Number.isFinite(timestamp.getTime())) {
    throw createPostgresLabelError(400, `Label ${fieldName} must be a valid ISO date.`);
  }

  return timestamp;
}

function toIsoString(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  return undefined;
}

function toVerificationRecord(record) {
  return {
    id: Number(record.id),
    checkedAt: toIsoString(record.checked_at),
    operation: record.operation,
    observationReset: Boolean(record.observation_reset),
    legacyCount: Number(record.legacy_count),
    postgresCount: Number(record.postgres_count),
    matchedCount: Number(record.matched_count),
    missingCount: Number(record.missing_count),
    extraCount: Number(record.extra_count),
    differentCount: Number(record.different_count),
    isExact: Boolean(record.is_exact),
    legacyHash: record.legacy_hash,
    postgresHash: record.postgres_hash,
    details: typeof record.details === 'string' ? JSON.parse(record.details) : record.details,
  };
}

function createPostgresLabelError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
