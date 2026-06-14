import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';

const testDataDir = path.resolve('.tmp', 'peptide-batch-parser-test-data');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_ALLOW_LOCAL_DEFAULTS = 'true';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const { createAdminSessionCookie } = await import('../server/helix-auth.mjs');
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
