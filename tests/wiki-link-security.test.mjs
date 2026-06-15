import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';

const testDataDir = path.resolve('.tmp', 'wiki-link-security-test-data');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_ALLOW_LOCAL_DEFAULTS = 'true';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const { createAdminSessionCookie } = await import('../server/helix-auth.mjs');
const { readCollection } = await import('../server/helix-data.mjs');

test('admin peptide save drops unsafe wiki URL schemes before returning and storing', async () => {
  await resetData();

  const response = await apiRequest({
    id: 'unsafe-wiki-test',
    name: 'Unsafe Wiki Test',
    categories: ['Recovery'],
    description: '',
    wikiLinks: [
      { source: 'other', url: 'javascript:alert(1)', status: 'manual' },
      { source: 'other', url: 'data:text/html,<h1>hi</h1>', status: 'manual' },
      { source: 'other', url: '/relative/wiki-path', status: 'manual' },
      { source: 'other', url: 'https://example.com/wiki', status: 'manual' },
      { source: 'pep-pedia', url: 'http://example.test/wiki', status: 'verified' },
    ],
  });

  assert.equal(response.statusCode, 200);

  const returnedPeptides = JSON.parse(response.body);
  const returnedPeptide = returnedPeptides.find((peptide) => peptide.id === 'unsafe-wiki-test');

  assert.deepEqual(
    returnedPeptide.wikiLinks.map((link) => link.url),
    ['http://example.test/wiki', 'https://example.com/wiki'],
  );

  const storedPeptides = await readCollection('peptides');
  const storedPeptide = storedPeptides.find((peptide) => peptide.id === 'unsafe-wiki-test');

  assert.deepEqual(
    storedPeptide.wikiLinks.map((link) => link.url),
    ['http://example.test/wiki', 'https://example.com/wiki'],
  );
});

async function resetData() {
  await rm(testDataDir, { recursive: true, force: true });
}

function apiRequest(body) {
  return handleHelixApiRequest({
    method: 'PUT',
    pathname: `/api/admin/data/peptides/${encodeURIComponent(body.id)}`,
    url: `/api/admin/data/peptides/${encodeURIComponent(body.id)}`,
    headers: {
      cookie: createAdminSessionCookie('admin'),
    },
    bodyText: JSON.stringify(body),
  });
}
