import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import path from 'node:path';

const testDataDir = path.resolve('.tmp', 'wiki-link-security-test-data');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_ALLOW_LOCAL_DEFAULTS = 'true';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const { createAdminSessionCookie } = await import('../server/helix-auth.mjs');
const { readCollection } = await import('../server/helix-data.mjs');

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

test('admin wiki search treats blend and stack suffixes as equivalent', async () => {
  await resetData();
  globalThis.fetch = async () => ({ ok: false });

  const wolverineResponse = await wikiSearchRequest('wolverine');
  const wolverineBlendResponse = await wikiSearchRequest('Wolverine Blend');

  assert.equal(wolverineResponse.statusCode, 200);
  assert.equal(wolverineBlendResponse.statusCode, 200);

  const wolverineBody = JSON.parse(wolverineResponse.body);
  const wolverineBlendBody = JSON.parse(wolverineBlendResponse.body);

  assert.deepEqual(wolverineBody.match.wikiLinks, [
    {
      source: 'pep-pedia',
      url: 'https://pep-pedia.org/peptides/wolverine-stack',
      status: 'verified',
    },
  ]);
  assert.deepEqual(wolverineBlendBody.match.wikiLinks, wolverineBody.match.wikiLinks);
});

async function resetData() {
  await rm(testDataDir, { recursive: true, force: true });
}

function wikiSearchRequest(name) {
  return handleHelixApiRequest({
    method: 'GET',
    pathname: '/api/admin/wiki/search',
    url: `/api/admin/wiki/search?name=${encodeURIComponent(name)}`,
    headers: {
      cookie: createAdminSessionCookie('admin'),
    },
    bodyText: '',
  });
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
