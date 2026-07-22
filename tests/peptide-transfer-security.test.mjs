import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const testDataDir = path.resolve('.tmp', 'peptide-transfer-test-data');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_ADMIN_PASSWORD = 'test-admin-password';
process.env.HELIX_OWNER_PASSWORD = 'test-owner-password';
process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
process.env.HELIX_LEGACY_ADMIN_AUTH = 'true';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const { createAdminSessionCookie } = await import('../server/helix-auth.mjs');
const { readCollection } = await import('../server/helix-data.mjs');

test('peptide transfer rejects logged-out and regular admin sessions', async () => {
  await resetData();

  const loggedOutExport = await apiRequest('/api/admin/data/peptides/export', 'GET');
  const loggedOutImport = await apiRequest('/api/admin/data/peptides/import', 'POST', createTransfer());
  const adminCookie = createAdminSessionCookie('admin');
  const adminExport = await apiRequest('/api/admin/data/peptides/export', 'GET', undefined, adminCookie);
  const adminImport = await apiRequest('/api/admin/data/peptides/import', 'POST', createTransfer(), adminCookie);

  assert.equal(loggedOutExport.statusCode, 401);
  assert.equal(loggedOutImport.statusCode, 401);
  assert.equal(adminExport.statusCode, 403);
  assert.equal(adminImport.statusCode, 403);
});

test('owner can export peptide transfer shape', async () => {
  await resetData();

  const response = await apiRequest('/api/admin/data/peptides/export', 'GET', undefined, createAdminSessionCookie('owner'));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.version, 1);
  assert.equal(body.collection, 'peptides');
  assert.equal(typeof body.exportedAt, 'string');
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.length > 0);
});

test('owner peptide export adds blank categories arrays for legacy records', async () => {
  await resetData();

  const ownerCookie = createAdminSessionCookie('owner');

  await apiRequest('/api/admin/data/peptides/legacy-no-categories', 'PUT', {
    id: 'legacy-no-categories',
    name: 'Legacy No Categories',
    description: 'Older local record without a categories field.',
    wikiLinks: [],
  }, ownerCookie);

  const response = await apiRequest('/api/admin/data/peptides/export', 'GET', undefined, ownerCookie);
  const body = JSON.parse(response.body);
  const exportedPeptide = body.items.find((item) => item.id === 'legacy-no-categories');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(exportedPeptide.categories, []);
});

test('owner peptide import replaces stale target peptides', async () => {
  await resetData();

  const response = await apiRequest('/api/admin/data/peptides/import', 'POST', createTransfer(), createAdminSessionCookie('owner'));
  const body = JSON.parse(response.body);
  const storedPeptides = await readCollection('peptides');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.map((item) => item.id), ['transfer-peptide']);
  assert.deepEqual(storedPeptides.map((item) => item.id), ['transfer-peptide']);
  assert.equal(storedPeptides[0].name, 'Transfer Peptide');
  assert.equal(storedPeptides[0].kind, 'peptide');
  assert.deepEqual(storedPeptides[0].components, []);
});

test('owner peptide import preserves sanitized blend metadata', async () => {
  await resetData();

  const response = await apiRequest('/api/admin/data/peptides/import', 'POST', {
    ...createTransfer(),
    items: [
      {
        ...createPeptide('recovery-blend', 'Recovery Blend'),
        kind: 'blend',
        components: [
          { peptideId: 'bpc-157', name: 'BPC-157', ratio: '1' },
          { peptideId: 'bpc-157', name: 'BPC-157 duplicate', ratio: '2' },
          { peptideId: '../tb-500', name: 'TB-500', ratio: '1' },
          { peptideId: 'empty-name', name: '', ratio: '1' },
        ],
      },
    ],
  }, createAdminSessionCookie('owner'));
  const storedPeptides = await readCollection('peptides');

  assert.equal(response.statusCode, 200);
  assert.equal(storedPeptides[0].kind, 'blend');
  assert.deepEqual(storedPeptides[0].components, [
    { peptideId: 'bpc-157', name: 'BPC-157', ratio: '1' },
    { peptideId: '..-tb-500', name: 'TB-500', ratio: '1' },
  ]);
});

test('owner peptide import accepts category-less peptide records', async () => {
  await resetData();

  const response = await apiRequest('/api/admin/data/peptides/import', 'POST', {
    ...createTransfer(),
    items: [
      {
        ...createPeptide('uncategorized-peptide', 'Uncategorized Peptide'),
        categories: [],
      },
    ],
  }, createAdminSessionCookie('owner'));
  const storedPeptides = await readCollection('peptides');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(storedPeptides[0].categories, []);
  assert.equal(storedPeptides[0].name, 'Uncategorized Peptide');
});

test('owner peptide import rejects invalid files and duplicate ids', async () => {
  await resetData();

  const ownerCookie = createAdminSessionCookie('owner');
  const wrongCollection = await apiRequest('/api/admin/data/peptides/import', 'POST', {
    ...createTransfer(),
    collection: 'vendors',
  }, ownerCookie);
  const duplicateIds = await apiRequest('/api/admin/data/peptides/import', 'POST', {
    ...createTransfer(),
    items: [
      createPeptide('duplicate-peptide', 'Duplicate Peptide'),
      createPeptide('duplicate-peptide', 'Duplicate Peptide Copy'),
    ],
  }, ownerCookie);
  const invalidRecord = await apiRequest('/api/admin/data/peptides/import', 'POST', {
    ...createTransfer(),
    items: [{ id: '', name: '', categories: [] }],
  }, ownerCookie);
  const emptyBlend = await apiRequest('/api/admin/data/peptides/import', 'POST', {
    ...createTransfer(),
    items: [{ ...createPeptide('empty-blend', 'Empty Blend'), kind: 'blend', components: [] }],
  }, ownerCookie);

  assert.equal(wrongCollection.statusCode, 400);
  assert.equal(duplicateIds.statusCode, 400);
  assert.equal(invalidRecord.statusCode, 400);
  assert.equal(emptyBlend.statusCode, 400);
});

async function resetData() {
  await rm(testDataDir, { recursive: true, force: true });
}

function createTransfer() {
  return {
    version: 1,
    collection: 'peptides',
    exportedAt: new Date().toISOString(),
    items: [createPeptide('transfer-peptide', 'Transfer Peptide')],
  };
}

function createPeptide(id, name) {
  return {
    id,
    name,
    categories: ['Recovery'],
    description: `${name} description`,
    wikiLinks: [
      {
        source: 'other',
        url: `https://example.test/${id}`,
        status: 'manual',
      },
    ],
  };
}

function apiRequest(pathname, method, body, cookie) {
  return handleHelixApiRequest({
    method,
    pathname,
    url: pathname,
    headers: {
      'user-agent': 'peptide-transfer-test',
      'x-forwarded-for': '127.0.0.44',
      ...(cookie ? { cookie } : {}),
    },
    bodyText: body === undefined ? '' : JSON.stringify(body),
  });
}
