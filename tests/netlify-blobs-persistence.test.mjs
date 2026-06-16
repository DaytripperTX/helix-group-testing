import assert from 'node:assert/strict';
import { test } from 'node:test';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzX7cgAAAABJRU5ErkJggg==';

test('Netlify data function seeds missing Blob documents and persists writes', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    HELIX_OWNER_PASSWORD: process.env.HELIX_OWNER_PASSWORD,
    NETLIFY: process.env.NETLIFY,
  };
  const previousFetch = globalThis.fetch;
  const blobs = new Map();
  const requests = [];

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.HELIX_OWNER_PASSWORD = 'test-owner-password';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const key = new URL(url).pathname;

    requests.push({ method, key });

    if (method === 'GET') {
      if (!blobs.has(key)) {
        return new Response('', { status: 404 });
      }

      return new Response(blobs.get(key), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (method === 'PUT') {
      blobs.set(key, String(options.body ?? ''));
      return new Response('', {
        status: 200,
        headers: { etag: `"${blobs.size}"` },
      });
    }

    return new Response('', { status: 405 });
  };

  try {
    const importId = Date.now();
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?blobs=${importId}`);
    const { handler } = await import(`../netlify/functions/data.mjs?blobs=${importId}`);
    const { handler: adminHandler } = await import(`../netlify/functions/admin.mjs?blobs=${importId}`);
    const eventBase = createNetlifyBlobsEvent();
    const peptidesResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/peptides',
      rawUrl: 'https://example.netlify.app/api/data/peptides',
    });

    assert.equal(peptidesResponse.statusCode, 200);
    assert.ok(JSON.parse(peptidesResponse.body).length > 0);
    assert.ok(requests.some((request) =>
      request.method === 'PUT' && request.key.endsWith('/site:helix-data/peptides.json'),
    ));

    const uploadResponse = await handler({
      ...eventBase,
      httpMethod: 'POST',
      path: '/api/labels',
      rawUrl: 'https://example.netlify.app/api/labels',
      headers: {
        ...eventBase.headers,
        'content-type': 'application/json',
        'user-agent': 'netlify-blobs-test',
        'x-forwarded-for': '203.0.113.12',
      },
      body: JSON.stringify(createLabelBody()),
      isBase64Encoded: false,
    });

    assert.equal(uploadResponse.statusCode, 200);
    assert.equal(JSON.parse(uploadResponse.body).length, 1);

    const labelsResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/labels',
      rawUrl: 'https://example.netlify.app/api/labels',
    });
    const labels = JSON.parse(labelsResponse.body);

    assert.equal(labelsResponse.statusCode, 200);
    assert.equal(labels.length, 1);
    assert.equal(labels[0].templateName, 'Persistent Netlify Label');
    assert.ok(requests.some((request) =>
      request.method === 'PUT' && request.key.endsWith('/site:helix-data/label-templates.json'),
    ));

    const importResponse = await adminHandler({
      ...eventBase,
      httpMethod: 'POST',
      path: '/api/admin/data/peptides/import',
      rawUrl: 'https://example.netlify.app/api/admin/data/peptides/import',
      headers: {
        ...eventBase.headers,
        cookie: createAdminSessionCookie('owner'),
        'content-type': 'application/json',
        'user-agent': 'netlify-blobs-test',
      },
      body: JSON.stringify({
        version: 1,
        collection: 'peptides',
        exportedAt: new Date().toISOString(),
        items: [
          {
            id: 'blob-transfer-peptide',
            name: 'Blob Transfer Peptide',
            categories: ['Recovery'],
            description: 'Imported through the owner transfer endpoint.',
            wikiLinks: [],
          },
        ],
      }),
      isBase64Encoded: false,
    });

    assert.equal(importResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(importResponse.body).map((item) => item.id), ['blob-transfer-peptide']);

    const replacedPeptidesResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/peptides',
      rawUrl: 'https://example.netlify.app/api/data/peptides',
    });

    assert.equal(replacedPeptidesResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(replacedPeptidesResponse.body).map((item) => item.id), ['blob-transfer-peptide']);
  } finally {
    globalThis.fetch = previousFetch;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

function createNetlifyBlobsEvent() {
  return {
    blobs: Buffer.from(JSON.stringify({
      token: 'test-token',
      url: 'https://blobs.example.test',
    })).toString('base64'),
    headers: {
      'x-nf-deploy-id': 'deploy123',
      'x-nf-site-id': 'site123',
    },
    body: null,
    isBase64Encoded: false,
  };
}

function createLabelBody() {
  return {
    previewDataUrl: `data:image/png;base64,${pngBase64}`,
    previewFileName: 'preview.png',
    niimbotCode: 'NIIMBOT-CODE',
    templateName: 'Persistent Netlify Label',
    peptideName: 'BPC-157',
    massMg: '10',
    labelSize: '40x20 mm',
    peptideCategories: ['Recovery'],
    tags: ['minimal', 'clean'],
    formStartedAt: Date.now() - 3000,
    honeypot: '',
  };
}
