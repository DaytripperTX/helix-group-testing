import assert from 'node:assert/strict';
import { test } from 'node:test';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzX7cgAAAABJRU5ErkJggg==';

test('Netlify data function seeds missing Blob documents and persists writes', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    HELIX_OWNER_PASSWORD: process.env.HELIX_OWNER_PASSWORD,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const requests = [];

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.HELIX_OWNER_PASSWORD = 'test-owner-password';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    requests.push({ method, key, host: requestUrl.host });

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

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
    assert.ok(requests.some((request) => request.host === 'uncached.blobs.example.test'));

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
    assert.equal(labels[0].previewDataUrl, undefined);
    assert.match(labels[0].previewAssetKey, /^label-previews\/niimbot-.+\.png$/);
    assert.ok(requests.some((request) =>
      request.method === 'PUT' && request.key.endsWith('/site:helix-data/label-templates.json'),
    ));
    assert.ok(requests.some((request) =>
      request.method === 'PUT' && request.key.includes('/site:helix-data/label-previews/'),
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
    globalThis.netlifyBlobsContext = previousBlobsContext;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('Netlify label admin edits persist when the base label document is stale', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const labelTemplatesKey = '/site123/site:helix-data/label-templates.json';
  let staleLabelTemplatesBody = null;

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

      if (key === labelTemplatesKey && staleLabelTemplatesBody) {
        return createJsonResponse(staleLabelTemplatesBody);
      }

      if (!blobs.has(key)) {
        return new Response('', { status: 404 });
      }

      return createJsonResponse(blobs.get(key));
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
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?staleBlobs=${importId}`);
    const { handler } = await import(`../netlify/functions/data.mjs?staleBlobs=${importId}`);
    const { handler: adminHandler } = await import(`../netlify/functions/admin.mjs?staleBlobs=${importId}`);
    const eventBase = createNetlifyBlobsEvent({ includeUncached: false });
    const adminCookie = createAdminSessionCookie('admin');
    const firstUpload = await postNetlifyLabel(handler, eventBase, createLabelBody({
      templateName: 'Stale Label A',
    }));
    const secondUpload = await postNetlifyLabel(handler, eventBase, createLabelBody({
      templateName: 'Stale Label B',
    }));
    const firstLabel = JSON.parse(firstUpload.body)[0];
    const secondLabel = JSON.parse(secondUpload.body)[0];

    staleLabelTemplatesBody = blobs.get(labelTemplatesKey);

    const approvedAResponse = await adminHandler(createAdminLabelEvent(eventBase, adminCookie, firstLabel.id, 'PUT', {
      ...firstLabel,
      moderationStatus: 'approved',
    }));
    const approvedBResponse = await adminHandler(createAdminLabelEvent(eventBase, adminCookie, secondLabel.id, 'PUT', {
      ...secondLabel,
      moderationStatus: 'approved',
    }));
    const approvedA = JSON.parse(approvedAResponse.body);
    const approvedB = JSON.parse(approvedBResponse.body);

    assert.equal(approvedAResponse.statusCode, 200);
    assert.equal(approvedBResponse.statusCode, 200);
    assert.equal(approvedA.moderationStatus, 'approved');
    assert.equal(approvedB.moderationStatus, 'approved');

    const editedAResponse = await adminHandler(createAdminLabelEvent(eventBase, adminCookie, firstLabel.id, 'PUT', {
      ...approvedA,
      templateName: 'Edited Stale Label A',
    }));
    const rejectedBResponse = await adminHandler(createAdminLabelEvent(eventBase, adminCookie, secondLabel.id, 'DELETE'));
    const recoveredBResponse = await adminHandler(createAdminLabelEvent(
      eventBase,
      adminCookie,
      secondLabel.id,
      'POST',
      undefined,
      'recover',
    ));
    const permanentBResponse = await adminHandler(createAdminLabelEvent(
      eventBase,
      adminCookie,
      secondLabel.id,
      'DELETE',
      undefined,
      'permanent',
    ));
    const editedA = JSON.parse(editedAResponse.body);
    const rejectedB = JSON.parse(rejectedBResponse.body);
    const recoveredB = JSON.parse(recoveredBResponse.body);
    const permanentB = JSON.parse(permanentBResponse.body);

    assert.equal(editedA.templateName, 'Edited Stale Label A');
    assert.equal(rejectedB.moderationStatus, 'rejected');
    assert.equal(rejectedB.deletedReason, 'admin');
    assert.equal(recoveredB.moderationStatus, 'unreviewed');
    assert.equal(recoveredB.deletedAt, undefined);
    assert.equal(permanentB.permanentlyDeleted, true);

    const labelsResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/label-templates',
      rawUrl: 'https://example.netlify.app/api/data/label-templates',
      headers: {
        ...eventBase.headers,
        cookie: adminCookie,
      },
    });
    const labels = JSON.parse(labelsResponse.body);
    const finalA = labels.find((label) => label.id === firstLabel.id);

    assert.equal(labelsResponse.statusCode, 200);
    assert.equal(finalA.templateName, 'Edited Stale Label A');
    assert.equal(finalA.moderationStatus, 'approved');
    assert.equal(labels.some((label) => label.id === secondLabel.id), false);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.netlifyBlobsContext = previousBlobsContext;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

function createNetlifyBlobsEvent({ includeUncached = true } = {}) {
  const blobsContext = {
    token: 'test-token',
    url: 'https://blobs.example.test',
    ...(includeUncached ? { uncached_url: 'https://uncached.blobs.example.test' } : {}),
  };

  return {
    blobs: Buffer.from(JSON.stringify(blobsContext)).toString('base64'),
    headers: {
      'x-nf-deploy-id': 'deploy123',
      'x-nf-site-id': 'site123',
    },
    body: null,
    isBase64Encoded: false,
  };
}

function createJsonResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createBlobListResponse(blobs, storePath, prefix) {
  const storePrefix = `${storePath}/`;
  const entries = [...blobs.keys()]
    .filter((key) => key.startsWith(storePrefix))
    .map((key) => key.slice(storePrefix.length))
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({ key, etag: `"${key}"` }));

  return createJsonResponse(JSON.stringify({
    blobs: entries,
    directories: [],
  }));
}

async function postNetlifyLabel(handler, eventBase, body) {
  return handler({
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
    body: JSON.stringify(body),
    isBase64Encoded: false,
  });
}

function createAdminLabelEvent(eventBase, adminCookie, labelId, method, body, action) {
  return {
    ...eventBase,
    httpMethod: method,
    path: `/api/admin/data/label-templates/${encodeURIComponent(labelId)}${action ? `/${action}` : ''}`,
    rawUrl: `https://example.netlify.app/api/admin/data/label-templates/${encodeURIComponent(labelId)}${action ? `/${action}` : ''}`,
    headers: {
      ...eventBase.headers,
      cookie: adminCookie,
      'content-type': 'application/json',
      'user-agent': 'netlify-blobs-test',
    },
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function createLabelBody(overrides = {}) {
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
    ...overrides,
  };
}
