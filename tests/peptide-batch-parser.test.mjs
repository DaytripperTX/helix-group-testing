import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';

const testDataDir = path.resolve('.tmp', 'peptide-batch-parser-test-data');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_ALLOW_LOCAL_DEFAULTS = 'true';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const { createAdminSessionCookie } = await import('../server/helix-auth.mjs');
const { readCollection } = await import('../server/helix-data.mjs');
const { peptideXlsxFixtureBase64 } = await import('./fixtures/spreadsheet-fixtures.mjs');

test('peptide batch parse requires an admin session', async () => {
  await resetData();
  const response = await apiRequest({
    headers: {},
    body: createParseBody('peptides.csv', 'name,categories\nBPC-157,Recovery'),
  });

  assert.equal(response.statusCode, 401);
});

test('peptide batch parse returns preview rows for valid admin CSV upload', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: createParseBody('peptides.csv', 'name,categories,description\nBPC-157,recovery,Repair peptide'),
  });

  assert.equal(response.statusCode, 200);

  const result = JSON.parse(response.body);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, 'BPC-157');
  assert.deepEqual(result.rows[0].categories, ['Recovery']);
  assert.equal(result.rows[0].description, 'Repair peptide');
  assert.deepEqual(result.rows[0].errors, []);
});

test('peptide batch parse returns blend components from valid admin CSV upload', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: createParseBody(
      'peptides.csv',
      [
        'name,kind,categories,components',
        'Recovery Blend,blend,Recovery,"[{""peptideId"":""bpc-157"",""name"":""BPC-157"",""ratio"":""1""},{""peptideId"":""tb-500"",""name"":""TB-500"",""ratio"":""1""}]"',
      ].join('\n'),
    ),
  });

  assert.equal(response.statusCode, 200);

  const result = JSON.parse(response.body);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].kind, 'blend');
  assert.deepEqual(result.rows[0].components, [
    { peptideId: 'bpc-157', name: 'BPC-157', ratio: '1' },
    { peptideId: 'tb-500', name: 'TB-500', ratio: '1' },
  ]);
  assert.deepEqual(result.rows[0].errors, []);
});

test('peptide batch parse marks malformed blend components as a row error', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: createParseBody(
      'peptides.csv',
      'name,kind,categories,components\nBroken Blend,blend,Recovery,"not json"',
    ),
  });

  assert.equal(response.statusCode, 200);

  const result = JSON.parse(response.body);

  assert.equal(result.rows[0].kind, 'blend');
  assert.deepEqual(result.rows[0].components, []);
  assert.deepEqual(result.rows[0].errors, ['Invalid components JSON']);
});

test('peptide batch parse requires components for blend rows', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: createParseBody('peptides.csv', 'name,kind,categories\nEmpty Blend,blend,Recovery'),
  });

  assert.equal(response.statusCode, 200);

  const result = JSON.parse(response.body);

  assert.deepEqual(result.rows[0].errors, ['Blend components are required']);
});

test('peptide batch parse returns preview rows for valid admin XLSX upload', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: {
      source: {
        type: 'file',
        fileName: 'peptides.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: peptideXlsxFixtureBase64,
      },
    },
  });

  assert.equal(response.statusCode, 200);

  const result = JSON.parse(response.body);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, 'BPC-157');
  assert.deepEqual(result.rows[0].errors, []);
});

test('peptide batch parse drops unsafe wiki URL schemes', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: createParseBody(
      'peptides.csv',
      [
        'name,wikiLinks,peptidepediaUrl,pepPediaUrl',
        'BPC-157,"[{""source"":""other"",""url"":""data:text/html,<h1>hi</h1>"",""status"":""manual""}]",javascript:alert(1),https://pep-pedia.org/peptides/bpc-157',
      ].join('\n'),
    ),
  });

  assert.equal(response.statusCode, 200);

  const result = JSON.parse(response.body);

  assert.deepEqual(result.rows[0].wikiLinks, [
    {
      source: 'pep-pedia',
      url: 'https://pep-pedia.org/peptides/bpc-157',
      status: 'manual',
    },
  ]);
  assert.deepEqual(result.rows[0].errors, []);
});

test('peptide batch parse rejects malformed uploads', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: createParseBody('peptides.xls', 'name,categories\nBPC-157,Recovery'),
  });

  assert.equal(response.statusCode, 400);
});

test('peptide batch parse rejects corrupt XLSX uploads', async () => {
  await resetData();
  const response = await apiRequest({
    headers: adminHeaders(),
    body: {
      source: {
        type: 'file',
        fileName: 'peptides.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from('not a workbook').toString('base64'),
      },
    },
  });

  assert.equal(response.statusCode, 400);
});

test('peptide batch import saves reviewed rows in one request', async () => {
  await resetData();
  const response = await apiBatchImport([
    createBatchRow(2, 'batch-alpha', 'Batch Alpha', ['Recovery']),
    createBatchRow(3, 'batch-beta', 'Batch Beta', ['Recovery']),
  ]);
  const result = JSON.parse(response.body);
  const storedPeptides = await readCollection('peptides');

  assert.equal(response.statusCode, 200);
  assert.equal(result.savedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.ok(result.items.some((item) => item.id === 'batch-alpha'));
  assert.ok(result.items.some((item) => item.id === 'batch-beta'));
  assert.ok(storedPeptides.some((item) => item.id === 'batch-alpha'));
  assert.ok(storedPeptides.some((item) => item.id === 'batch-beta'));
});

test('peptide batch import reports row-level save failures', async () => {
  await resetData();
  const response = await apiBatchImport([
    createBatchRow(2, 'valid-bpc-157', 'BPC-157', ['Recovery']),
    createBatchRow(3, 'empty-blend', 'Empty Blend', ['Recovery'], {
      kind: 'blend',
      components: [],
    }),
  ]);
  const result = JSON.parse(response.body);
  const storedPeptides = await readCollection('peptides');

  assert.equal(response.statusCode, 400);
  assert.equal(result.error, 'Peptide batch import contains rows that could not be saved.');
  assert.equal(result.details.failedCount, 1);
  assert.equal(result.details.rowErrors[0].rowNumber, 3);
  assert.match(result.details.rowErrors[0].error, /Blend components/);
  assert.equal(storedPeptides.some((item) => item.id === 'valid-bpc-157'), false);
});

test('peptide category batch import saves multiple categories in one request', async () => {
  await resetData();
  const response = await apiCategoryBatchImport([
    { id: 'category-alpha', name: 'Category Alpha' },
    { id: 'category-beta', name: 'Category Beta' },
  ]);
  const result = JSON.parse(response.body);
  const storedCategories = await readCollection('peptide-categories');

  assert.equal(response.statusCode, 200);
  assert.equal(result.savedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.ok(storedCategories.some((item) => item.id === 'category-alpha'));
  assert.ok(storedCategories.some((item) => item.id === 'category-beta'));
});

async function resetData() {
  await rm(testDataDir, { recursive: true, force: true });
}

function adminHeaders() {
  return {
    cookie: createAdminSessionCookie('admin'),
  };
}

function createParseBody(fileName, content) {
  return {
    source: {
      type: 'file',
      fileName,
      mimeType: fileName.endsWith('.csv') ? 'text/csv' : 'application/octet-stream',
      base64: Buffer.from(content).toString('base64'),
    },
  };
}

function apiRequest({ headers, body }) {
  return handleHelixApiRequest({
    method: 'POST',
    pathname: '/api/admin/peptides/parse-batch',
    url: '/api/admin/peptides/parse-batch',
    headers,
    bodyText: JSON.stringify(body),
  });
}

function apiBatchImport(rows) {
  return handleHelixApiRequest({
    method: 'POST',
    pathname: '/api/admin/peptides/import-batch',
    url: '/api/admin/peptides/import-batch',
    headers: adminHeaders(),
    bodyText: JSON.stringify({ rows }),
  });
}

function apiCategoryBatchImport(rows) {
  return handleHelixApiRequest({
    method: 'POST',
    pathname: '/api/admin/peptide-categories/import-batch',
    url: '/api/admin/peptide-categories/import-batch',
    headers: adminHeaders(),
    bodyText: JSON.stringify({ rows }),
  });
}

function createBatchRow(rowNumber, id, name, categories, overrides = {}) {
  return {
    rowNumber,
    id,
    name,
    kind: 'peptide',
    categories,
    description: `${name} description`,
    components: [],
    wikiLinks: [],
    errors: [],
    ...overrides,
  };
}
