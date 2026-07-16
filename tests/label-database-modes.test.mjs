import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NetlifyDB } from '@netlify/database-dev';

const testDataDir = path.resolve('.tmp', 'label-database-mode-test-data');
const migrationsDirectory = fileURLToPath(new URL('../netlify/database/migrations/', import.meta.url));
const database = new NetlifyDB({ logger: () => {} });

process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_DATA_ADAPTER = 'local';
process.env.HELIX_ADMIN_PASSWORD = 'database-test-admin';
process.env.HELIX_OWNER_PASSWORD = 'database-test-owner';
process.env.HELIX_ADMIN_SESSION_SECRET = 'database-test-session-secret';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const data = await import('../server/helix-data.mjs');
const repository = await import('../server/helix-label-postgres.mjs');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzX7cgAAAABJRU5ErkJggg==';
const validPreviewDataUrl = `data:image/png;base64,${pngBase64}`;

before(async () => {
  process.env.NETLIFY_DB_URL = await database.start();
  process.env.NETLIFY_DB_DRIVER = 'server';
});

beforeEach(async () => {
  delete globalThis.__helixLabelPostgresRepository;
  process.env.HELIX_DATA_MODE = 'legacy';
  await repository.closeLabelDatabaseClientForTests();
  await database.reset();
  await database.applyMigrations(migrationsDirectory);
  await rm(testDataDir, { recursive: true, force: true });
});

after(async () => {
  delete globalThis.__helixLabelPostgresRepository;
  await repository.closeLabelDatabaseClientForTests();
  await database.stop();
  await rm(testDataDir, { recursive: true, force: true });
  delete process.env.NETLIFY_DB_URL;
  delete process.env.NETLIFY_DB_DRIVER;
});

test('database operation endpoints require an owner session', async () => {
  const unauthenticated = await apiRequest('/api/admin/database/labels/status', 'GET');
  const adminCookie = await login('admin');
  const forbidden = await apiRequest('/api/admin/database/labels/status', 'GET', undefined, { cookie: adminCookie });
  const ownerCookie = await login('owner');

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);

  for (const [pathname, method, body] of [
    ['/api/admin/database/labels/status', 'GET'],
    ['/api/admin/database/labels/verify', 'POST'],
    ['/api/admin/database/labels/backfill', 'POST'],
    ['/api/admin/database/labels/repair', 'POST', { confirmation: 'wrong' }],
  ]) {
    const response = await apiRequest(pathname, method, body, { cookie: ownerCookie });
    assert.notEqual(response.statusCode, 401);
    assert.notEqual(response.statusCode, 403);
  }
});

test('backfill is idempotent, protects newer SQL rows, and repair makes SQL exactly match legacy', async () => {
  await postLabel({ templateName: 'Legacy authoritative' });
  const [legacyLabel] = await data.readCollection('label-templates');
  const ownerCookie = await login('owner');

  const firstBackfill = await apiRequest('/api/admin/database/labels/backfill', 'POST', undefined, { cookie: ownerCookie });
  const firstResult = JSON.parse(firstBackfill.body);

  assert.equal(firstBackfill.statusCode, 200);
  assert.equal(firstResult.insertedCount, 1);
  assert.equal(firstResult.verification.isExact, true);

  const secondBackfill = await apiRequest('/api/admin/database/labels/backfill', 'POST', undefined, { cookie: ownerCookie });
  assert.equal(secondBackfill.statusCode, 200);
  assert.equal(JSON.parse(secondBackfill.body).updatedCount, 1);

  await repository.upsertPostgresLabelSnapshot({
    ...legacyLabel,
    templateName: 'Newer SQL shadow write',
    updatedAt: new Date(Date.parse(legacyLabel.updatedAt) + 60_000).toISOString(),
  }, { force: true });
  await repository.upsertPostgresLabelSnapshot(createStoredLabel({ id: 'sql-only-label' }), { force: true });

  const protectedBackfill = await apiRequest('/api/admin/database/labels/backfill', 'POST', undefined, { cookie: ownerCookie });
  const protectedResult = JSON.parse(protectedBackfill.body);

  assert.equal(protectedBackfill.statusCode, 200);
  assert.equal(protectedResult.skippedNewerCount, 1);
  assert.equal(protectedResult.verification.isExact, false);
  assert.deepEqual(protectedResult.verification.differentIds, [legacyLabel.id]);
  assert.deepEqual(protectedResult.verification.extraInPostgresIds, ['sql-only-label']);

  const legacyMetadataBeforeRepair = await readFile(path.join(testDataDir, 'label-templates.json'), 'utf8');
  const repair = await apiRequest('/api/admin/database/labels/repair', 'POST', {
    confirmation: 'repair-postgres-from-legacy',
  }, { cookie: ownerCookie });
  const repairResult = JSON.parse(repair.body);

  assert.equal(repair.statusCode, 200);
  assert.deepEqual(repairResult.removedIds, ['sql-only-label']);
  assert.equal(repairResult.verification.isExact, true);
  assert.equal(repairResult.verification.verification.operation, 'repair');
  assert.equal(repairResult.verification.verification.observationReset, true);
  assert.equal(await readFile(path.join(testDataDir, 'label-templates.json'), 'utf8'), legacyMetadataBeforeRepair);

  const status = JSON.parse((await apiRequest('/api/admin/database/labels/status', 'GET', undefined, {
    cookie: ownerCookie,
  })).body);

  assert.equal(status.mode, 'legacy');
  assert.equal(status.database.ok, true);
  assert.deepEqual(status.counts, {
    legacy: 1,
    postgres: 1,
    blockedLegacy: 0,
    unresolvedShadowFailures: 0,
  });
  assert.equal(status.discrepancies.isExact, true);
});

test('backfill reports invalid external preview metadata without mutating legacy', async () => {
  await mkdir(testDataDir, { recursive: true });
  const legacyDocument = {
    version: 1,
    updatedAt: '2026-07-14T12:00:00.000Z',
    items: [{
      ...createStoredLabel({ id: 'inline-preview-label' }),
      previewDataUrl: validPreviewDataUrl,
      previewFileName: 'inline.png',
      previewAssetKey: undefined,
      previewMimeType: undefined,
      previewByteLength: undefined,
      previewUrl: undefined,
    }],
  };
  const legacyPath = path.join(testDataDir, 'label-templates.json');
  const legacyText = `${JSON.stringify(legacyDocument, null, 2)}\n`;
  await writeFile(legacyPath, legacyText, 'utf8');
  const ownerCookie = await login('owner');

  const response = await apiRequest('/api/admin/database/labels/backfill', 'POST', undefined, { cookie: ownerCookie });
  const result = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(result.blockedIds, ['inline-preview-label']);
  assert.equal(result.verification.isExact, false);
  assert.deepEqual(result.verification.blockedIds, ['inline-preview-label']);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyText);
  assert.deepEqual(await repository.readPostgresLabelTemplates(), []);

  const repair = await apiRequest('/api/admin/database/labels/repair', 'POST', {
    confirmation: 'repair-postgres-from-legacy',
  }, { cookie: ownerCookie });

  assert.equal(repair.statusCode, 409);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyText);
  assert.deepEqual(await repository.readPostgresLabelTemplates(), []);
});

test('postgres mode runs the unchanged API contracts through SQL-authoritative workflows', async () => {
  process.env.HELIX_DATA_MODE = 'postgres';
  const upload = await postLabel({ templateName: 'SQL API label' });
  const [publicLabel] = JSON.parse(upload.body);

  assert.equal(upload.statusCode, 200);
  assert.equal(publicLabel.reports, undefined);
  assert.equal(publicLabel.voteFingerprints, undefined);

  const vote = await apiRequest('/api/labels/vote', 'POST', {
    id: publicLabel.id,
    direction: 1,
  }, { ip: '192.0.2.10', userAgent: 'postgres-api-voter' });
  const report = await apiRequest('/api/labels/report', 'POST', {
    id: publicLabel.id,
    reason: 'spam',
    details: 'SQL report',
  }, { ip: '192.0.2.11', userAgent: 'postgres-api-reporter' });

  assert.equal(vote.statusCode, 200);
  assert.equal(report.statusCode, 200);

  let [stored] = await repository.readPostgresLabelTemplates();
  assert.equal(stored.votes, 1);
  assert.equal(stored.reportCount, 1);

  const adminCookie = await login('admin');
  const edit = await apiRequest(`/api/admin/data/label-templates/${encodeURIComponent(stored.id)}`, 'PUT', {
    ...stored,
    templateName: 'SQL admin edit',
    moderationStatus: 'approved',
  }, { cookie: adminCookie });

  assert.equal(edit.statusCode, 200);
  stored = JSON.parse(edit.body);
  assert.equal(stored.templateName, 'SQL admin edit');
  assert.equal(stored.votes, 1);
  assert.equal(stored.reportCount, 1);

  const clearReports = await apiRequest(`/api/admin/data/label-templates/${encodeURIComponent(stored.id)}`, 'PUT', {
    ...stored,
    clearReports: true,
  }, { cookie: adminCookie });
  assert.equal(JSON.parse(clearReports.body).reportCount, 0);

  const softDelete = await apiRequest(`/api/admin/data/label-templates/${encodeURIComponent(stored.id)}`, 'DELETE', undefined, {
    cookie: adminCookie,
  });
  assert.equal(JSON.parse(softDelete.body).deletedReason, 'admin');
  assert.deepEqual(JSON.parse((await apiRequest('/api/labels', 'GET')).body), []);

  const recover = await apiRequest(`/api/admin/data/label-templates/${encodeURIComponent(stored.id)}/recover`, 'POST', undefined, {
    cookie: adminCookie,
  });
  assert.equal(JSON.parse(recover.body).moderationStatus, 'unreviewed');

  const permanent = await apiRequest(`/api/admin/data/label-templates/${encodeURIComponent(stored.id)}/permanent`, 'DELETE', undefined, {
    cookie: adminCookie,
  });
  assert.equal(JSON.parse(permanent.body).permanentlyDeleted, true);
  assert.deepEqual(await repository.readPostgresLabelTemplates(), []);
});

test('shadow SQL outage leaves legacy API successful, writes a safe marker, and postgres mode fails closed', async () => {
  process.env.HELIX_DATA_MODE = 'shadow';
  globalThis.__helixLabelPostgresRepository = {
    async upsertPostgresLabelSnapshot() {
      const error = new Error('secret database failure with payload');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    async readPostgresLabelTemplates() {
      throw new Error('database unavailable');
    },
  };

  const upload = await postLabel({
    templateName: 'Shadow survives',
    niimbotCode: 'SECRET-LABEL-CODE',
  });

  assert.equal(upload.statusCode, 200);
  assert.equal((await data.readCollection('label-templates')).length, 1);

  const failureDir = path.join(testDataDir, 'label-sql-shadow-failures');
  const [failureFile] = await readdir(failureDir);
  const markerText = await readFile(path.join(failureDir, failureFile), 'utf8');
  const marker = JSON.parse(markerText);

  assert.deepEqual(Object.keys(marker).sort(), [
    'deployContext',
    'errorCode',
    'failedAt',
    'id',
    'labelId',
    'operation',
  ]);
  assert.equal(marker.operation, 'upload');
  assert.equal(marker.errorCode, 'connection');
  assert.equal(markerText.includes('SECRET-LABEL-CODE'), false);
  assert.equal(markerText.includes('secret database failure'), false);

  const ownerCookie = await login('owner');
  const statusDuringOutage = JSON.parse((await apiRequest('/api/admin/database/labels/status', 'GET', undefined, {
    cookie: ownerCookie,
  })).body);

  assert.equal(statusDuringOutage.counts.unresolvedShadowFailures, 1);
  assert.equal(statusDuringOutage.unresolvedShadowFailures.length, 1);
  assert.equal(statusDuringOutage.unresolvedShadowFailures[0].errorCode, 'connection');
  assert.equal(JSON.stringify(statusDuringOutage.unresolvedShadowFailures).includes('SECRET-LABEL-CODE'), false);

  process.env.HELIX_DATA_MODE = 'postgres';
  const postgresRead = await apiRequest('/api/labels', 'GET');

  assert.equal(postgresRead.statusCode, 500);
  assert.deepEqual(JSON.parse(postgresRead.body), { error: 'Server error' });

  delete globalThis.__helixLabelPostgresRepository;
  process.env.HELIX_DATA_MODE = 'legacy';
  const correction = await apiRequest('/api/admin/database/labels/backfill', 'POST', undefined, { cookie: ownerCookie });

  assert.equal(correction.statusCode, 200);
  assert.equal(JSON.parse(correction.body).verification.isExact, true);
  assert.equal(JSON.parse(await readFile(path.join(failureDir, failureFile), 'utf8')).resolvedAt !== undefined, true);
});

async function login(role) {
  const response = await apiRequest('/api/admin/login', 'POST', {
    role,
    password: role === 'owner' ? process.env.HELIX_OWNER_PASSWORD : process.env.HELIX_ADMIN_PASSWORD,
  });

  assert.equal(response.statusCode, 200);
  return response.headers['Set-Cookie'];
}

async function postLabel(overrides = {}) {
  return apiRequest('/api/labels', 'POST', {
    previewDataUrl: validPreviewDataUrl,
    previewFileName: 'preview.png',
    niimbotCode: 'NIIMBOT-CODE',
    templateName: 'Clean Template',
    peptideName: 'BPC-157',
    massMg: '10',
    labelSize: '40x20 mm',
    peptideCategories: ['Recovery'],
    tags: ['clean'],
    formStartedAt: Date.now() - 3000,
    honeypot: '',
    ...overrides,
  });
}

async function apiRequest(pathname, method, body, client = {}) {
  return handleHelixApiRequest({
    method,
    pathname,
    url: pathname,
    headers: {
      'user-agent': client.userAgent ?? `label-database-mode-test-${Math.random()}`,
      'x-forwarded-for': client.ip ?? `127.0.1.${Math.floor(Math.random() * 200) + 1}`,
      ...(client.cookie ? { cookie: client.cookie } : {}),
    },
    bodyText: body === undefined ? '' : JSON.stringify(body),
  });
}

function createStoredLabel(overrides = {}) {
  const now = '2026-07-14T12:00:00.000Z';
  const id = overrides.id ?? 'stored-label';

  return {
    id,
    previewAssetKey: `label-previews/${id}.png`,
    previewMimeType: 'image/png',
    previewFileName: 'preview.png',
    previewByteLength: 128,
    previewUrl: `/api/labels/${id}/preview`,
    niimbotCode: 'NIIMBOT-CODE',
    templateName: 'Stored label',
    peptideName: 'BPC-157',
    massMg: '10',
    labelSize: '40x20 mm',
    peptideCategories: ['Recovery'],
    tags: ['clean'],
    votes: 0,
    voteFingerprints: [],
    moderationStatus: 'unreviewed',
    reportCount: 0,
    reports: [],
    reportFingerprints: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
