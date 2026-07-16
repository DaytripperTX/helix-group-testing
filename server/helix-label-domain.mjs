export const LABEL_TRASH_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
export const MAX_LABEL_REPORTS = 50;
export const MAX_REPORT_COUNT_BEFORE_HIDE = 5;

const allowedModerationStatuses = new Set(['unreviewed', 'approved', 'rejected']);
const allowedReportReasons = new Set(['offensive', 'spam', 'unsafe', 'other']);
const allowedPreviewMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function normalizeReportReason(value) {
  const reason = typeof value === 'string' ? value.trim().toLowerCase() : '';

  return allowedReportReasons.has(reason) ? reason : '';
}

export function normalizeModerationStatus(value) {
  if (value === 'pending') {
    return 'unreviewed';
  }

  return allowedModerationStatuses.has(value) ? value : 'unreviewed';
}

export function normalizeFingerprintList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim()))];
}

export function normalizeStoredLabelTemplate(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return item;
  }

  const reportTimestampFallback = normalizeCanonicalTimestamp(item.updatedAt)
    ?? normalizeCanonicalTimestamp(item.createdAt)
    ?? new Date().toISOString();
  const reports = Array.isArray(item.reports)
    ? item.reports.map((report) => ({
        reason: normalizeReportReason(report?.reason) || 'other',
        details: typeof report?.details === 'string' ? report.details : '',
        ...(typeof report?.fingerprint === 'string' ? { fingerprint: report.fingerprint } : {}),
        createdAt: isValidTimestamp(report?.createdAt) ? report.createdAt : reportTimestampFallback,
      }))
    : [];
  const reportFingerprints = normalizeFingerprintList(item.reportFingerprints);
  const nextReportFingerprints = reportFingerprints.length
    ? reportFingerprints
    : normalizeFingerprintList(reports.map((report) => report.fingerprint).filter(Boolean));
  const voteFingerprints = normalizeFingerprintList(item.voteFingerprints);
  const moderationStatus = normalizeModerationStatus(item.moderationStatus);
  const nextItem = {
    ...item,
    moderationStatus,
    votes: voteFingerprints.length || Math.max(0, Math.round(Number(item.votes) || 0)),
    voteFingerprints,
    reports,
    reportFingerprints: nextReportFingerprints,
    reportCount: nextReportFingerprints.length || reports.length || Math.max(0, Math.round(Number(item.reportCount) || 0)),
  };

  if (moderationStatus === 'rejected' && !nextItem.deletedAt) {
    nextItem.deletedAt = typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString();
    nextItem.deletedReason = 'rejected';
  }

  if (typeof nextItem.deletedAt !== 'string') {
    delete nextItem.deletedAt;
    delete nextItem.deletedReason;
  } else if (!['admin', 'rejected'].includes(nextItem.deletedReason)) {
    nextItem.deletedReason = moderationStatus === 'rejected' ? 'rejected' : 'admin';
  }

  return nextItem;
}

export function validateLabelTemplateSnapshot(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id) {
    return { ok: false, reason: 'Invalid label template.' };
  }

  if (
    typeof item.previewAssetKey !== 'string' ||
    !item.previewAssetKey.startsWith('label-previews/') ||
    !allowedPreviewMimeTypes.has(item.previewMimeType) ||
    typeof item.previewFileName !== 'string' ||
    !item.previewFileName.trim() ||
    !Number.isInteger(Number(item.previewByteLength)) ||
    Number(item.previewByteLength) < 0
  ) {
    return { ok: false, reason: 'Label preview must already use external Blob storage.' };
  }

  for (const [field, value] of [
    ['NIIMBOT code', item.niimbotCode],
    ['Peptide name', item.peptideName],
    ['Mass', item.massMg],
    ['Label size', item.labelSize],
  ]) {
    if (typeof value !== 'string' || !value) {
      return { ok: false, reason: `${field} is required.` };
    }
  }

  if (!isValidTimestamp(item.createdAt) || !isValidTimestamp(item.updatedAt)) {
    return { ok: false, reason: 'Label timestamps must be valid ISO dates.' };
  }

  if (item.deletedAt && !isValidTimestamp(item.deletedAt)) {
    return { ok: false, reason: 'Label deletion timestamp must be a valid ISO date.' };
  }

  return { ok: true };
}

export function createLabelTemplateTombstone(itemId, now = new Date().toISOString()) {
  return {
    id: itemId,
    permanentlyDeleted: true,
    deletedAt: now,
    deletedReason: 'permanent',
    updatedAt: now,
  };
}

export function isLabelTemplateTombstone(item) {
  return Boolean(
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.id === 'string' &&
    item.permanentlyDeleted === true,
  );
}

export function purgeExpiredTrash(items, now = Date.now()) {
  return items.filter((item) => !isExpiredTrashLabel(item, now));
}

export function isExpiredTrashLabel(item, now = Date.now()) {
  if (!item?.deletedAt) {
    return false;
  }

  const deletedAt = Date.parse(item.deletedAt);

  return Number.isFinite(deletedAt) && now - deletedAt >= LABEL_TRASH_RETENTION_MS;
}

export function getDistinctReportCount(template) {
  const reportFingerprints = normalizeFingerprintList(template?.reportFingerprints);

  if (reportFingerprints.length) {
    return reportFingerprints.length;
  }

  return Math.max(0, Math.round(Number(template?.reportCount) || 0));
}

export function isPubliclyVisibleLabelTemplate(template) {
  const status = normalizeModerationStatus(template?.moderationStatus ?? 'unreviewed');
  const reportCount = getDistinctReportCount(template);

  return !template?.deletedAt && status !== 'rejected' && reportCount < MAX_REPORT_COUNT_BEFORE_HIDE;
}

export function toPublicLabelTemplate(template) {
  const {
    reportFingerprints,
    voteFingerprints,
    reports,
    deletedAt,
    deletedReason,
    ...publicTemplate
  } = template;

  return publicTemplate;
}

export function createLabelPreviewUrl(labelId) {
  return `/api/labels/${encodeURIComponent(labelId)}/preview`;
}

export function canonicalizeLabelTemplate(item) {
  const normalized = normalizeStoredLabelTemplate(item);
  const canonical = {
    id: normalized.id,
    previewAssetKey: normalized.previewAssetKey,
    previewMimeType: normalized.previewMimeType,
    previewFileName: normalized.previewFileName,
    previewByteLength: Math.max(0, Math.round(Number(normalized.previewByteLength) || 0)),
    previewUrl: createLabelPreviewUrl(normalized.id),
    niimbotCode: normalized.niimbotCode,
    templateName: normalized.templateName,
    peptideName: normalized.peptideName,
    massMg: normalized.massMg,
    labelSize: normalized.labelSize,
    peptideCategories: Array.isArray(normalized.peptideCategories) ? normalized.peptideCategories : [],
    tags: Array.isArray(normalized.tags) ? normalized.tags : [],
    votes: Math.max(0, Math.round(Number(normalized.votes) || 0)),
    voteFingerprints: normalizeFingerprintList(normalized.voteFingerprints),
    moderationStatus: normalizeModerationStatus(normalized.moderationStatus),
    reportCount: Math.max(0, Math.round(Number(normalized.reportCount) || 0)),
    reports: Array.isArray(normalized.reports)
      ? normalized.reports.map((report) => ({
          ...report,
          createdAt: normalizeCanonicalTimestamp(report.createdAt) ?? report.createdAt,
        }))
      : [],
    reportFingerprints: normalizeFingerprintList(normalized.reportFingerprints),
    deletedAt: normalizeCanonicalTimestamp(normalized.deletedAt) ?? normalized.deletedAt,
    deletedReason: normalized.deletedReason,
    createdAt: normalizeCanonicalTimestamp(normalized.createdAt) ?? normalized.createdAt,
    updatedAt: normalizeCanonicalTimestamp(normalized.updatedAt) ?? normalized.updatedAt,
  };

  return removeUndefinedValues(canonical);
}

export function stableStringify(value) {
  return JSON.stringify(sortObjectKeys(value));
}

function removeUndefinedValues(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function normalizeCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function isValidTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObjectKeys(value[key])]),
  );
}
