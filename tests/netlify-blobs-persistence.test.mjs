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
    const { handleLambdaEvent: handler } = await import(`../netlify/functions/data.mjs?blobs=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?blobs=${importId}`);
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
    const { handleLambdaEvent: handler } = await import(`../netlify/functions/data.mjs?staleBlobs=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?staleBlobs=${importId}`);
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

test('Netlify peptide batch import writes all rows from one stale Blob snapshot', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const requests = [];
  const peptidesKey = '/site123/site:helix-data/peptides.json';
  let stalePeptidesBody = null;

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    requests.push({ method, key });

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

      if (key === peptidesKey && stalePeptidesBody) {
        return createJsonResponse(stalePeptidesBody);
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
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?peptideBatchBlobs=${importId}`);
    const { handleLambdaEvent: handler } = await import(`../netlify/functions/data.mjs?peptideBatchBlobs=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?peptideBatchBlobs=${importId}`);
    const eventBase = createNetlifyBlobsEvent({ includeUncached: false });

    const seedResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/peptides',
      rawUrl: 'https://example.netlify.app/api/data/peptides',
    });

    assert.equal(seedResponse.statusCode, 200);
    stalePeptidesBody = blobs.get(peptidesKey);

    const writeCountBeforeImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === peptidesKey
    ).length;
    const importResponse = await adminHandler({
      ...eventBase,
      httpMethod: 'POST',
      path: '/api/admin/peptides/import-batch',
      rawUrl: 'https://example.netlify.app/api/admin/peptides/import-batch',
      headers: {
        ...eventBase.headers,
        cookie: createAdminSessionCookie('admin'),
        'content-type': 'application/json',
        'user-agent': 'netlify-blobs-test',
      },
      body: JSON.stringify({
        rows: [
          createPeptideBatchRow(2, 'netlify-batch-a', 'Netlify Batch A'),
          createPeptideBatchRow(3, 'netlify-batch-b', 'Netlify Batch B'),
        ],
      }),
      isBase64Encoded: false,
    });
    const result = JSON.parse(importResponse.body);
    const writeCountAfterImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === peptidesKey
    ).length;
    const storedDocument = JSON.parse(blobs.get(peptidesKey));
    const storedIds = storedDocument.items.map((item) => item.id);

    assert.equal(importResponse.statusCode, 200);
    assert.equal(result.savedCount, 2);
    assert.ok(result.items.some((item) => item.id === 'netlify-batch-a'));
    assert.ok(result.items.some((item) => item.id === 'netlify-batch-b'));
    assert.equal(writeCountAfterImport, writeCountBeforeImport + 1);
    assert.ok(storedIds.includes('netlify-batch-a'));
    assert.ok(storedIds.includes('netlify-batch-b'));
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

test('Netlify COA batch import writes all rows from one stale Blob snapshot', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const requests = [];
  const coasKey = '/site123/site:helix-data/coas.json';
  let staleCoasBody = null;

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    requests.push({ method, key });

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

      if (key === coasKey && staleCoasBody) {
        return createJsonResponse(staleCoasBody);
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
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?coaBatchBlobs=${importId}`);
    const { handleLambdaEvent: handler } = await import(`../netlify/functions/data.mjs?coaBatchBlobs=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?coaBatchBlobs=${importId}`);
    const eventBase = createNetlifyBlobsEvent({ includeUncached: false });
    const adminCookie = createAdminSessionCookie('admin');

    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/peptides/bpc-157', 'PUT', {
      id: 'bpc-157',
      name: 'BPC-157',
      kind: 'peptide',
      categories: ['Recovery'],
    }))).statusCode, 200);
    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/rounds/round-coa-batch', 'PUT', {
      id: 'round-coa-batch',
      name: 'Round COA Batch',
      status: 'Collecting signups',
      vendorId: 'vendor-one',
      isCurrent: false,
      startDate: '',
      endDate: '',
      targetWindow: '',
      participants: 0,
      roundDiscountPercent: 0,
      priceSourceMode: 'none',
      priceListSnapshot: null,
      peptides: [
        {
          id: 'round-row-bpc',
          peptideId: 'bpc-157',
          peptideName: 'BPC-157',
          priceListItemId: '',
          vendorCode: 'BPC10',
          vendorPrice: 42,
          vendorPriceOverridden: false,
          mass: '10 mg',
          testingTier: 'gold',
          additionalTesting: '',
          batchConformity: false,
          capColor: '',
          notes: '',
          participantCount: 0,
          totalOrdered: 0,
        },
      ],
    }))).statusCode, 200);

    const seedResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/coas',
      rawUrl: 'https://example.netlify.app/api/data/coas',
    });

    assert.equal(seedResponse.statusCode, 200);
    staleCoasBody = blobs.get(coasKey);

    const writeCountBeforeImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === coasKey
    ).length;
    const importResponse = await adminHandler(createNetlifyAdminEvent(
      eventBase,
      adminCookie,
      '/api/admin/coas/import-batch',
      'POST',
      {
        rows: [
          createCoaBatchItem('netlify-coa-a', 'HLX-MIA-BPC10-0626-BLUE', 'Blue'),
          createCoaBatchItem('netlify-coa-b', 'HLX-MIA-BPC10-0626-WHITE', 'White'),
        ],
      },
    ));
    const result = JSON.parse(importResponse.body);
    const writeCountAfterImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === coasKey
    ).length;
    const storedDocument = JSON.parse(blobs.get(coasKey));
    const storedIds = storedDocument.items.map((item) => item.id);

    assert.equal(importResponse.statusCode, 200);
    assert.equal(result.savedCount, 2);
    assert.equal(writeCountAfterImport, writeCountBeforeImport + 1);
    assert.ok(storedIds.includes('netlify-coa-a'));
    assert.ok(storedIds.includes('netlify-coa-b'));
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

test('Netlify COA batch delete removes all requested rows from one stale Blob snapshot', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const requests = [];
  const coasKey = '/site123/site:helix-data/coas.json';
  let staleCoasBody = null;

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    requests.push({ method, key });

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

      if (key === coasKey && staleCoasBody) {
        return createJsonResponse(staleCoasBody);
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
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?coaDeleteBlobs=${importId}`);
    const { handleLambdaEvent: handler } = await import(`../netlify/functions/data.mjs?coaDeleteBlobs=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?coaDeleteBlobs=${importId}`);
    const eventBase = createNetlifyBlobsEvent({ includeUncached: false });
    const adminCookie = createAdminSessionCookie('admin');

    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/peptides/bpc-157', 'PUT', {
      id: 'bpc-157',
      name: 'BPC-157',
      kind: 'peptide',
      categories: ['Recovery'],
    }))).statusCode, 200);
    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/rounds/round-coa-batch', 'PUT', createRoundBatchItem({
      id: 'round-coa-batch',
      name: 'Round COA Batch',
      peptides: [
        {
          id: 'round-row-bpc',
          peptideId: 'bpc-157',
          peptideName: 'BPC-157',
          priceListItemId: '',
          vendorCode: 'BPC10',
          vendorPrice: 42,
          vendorPriceOverridden: false,
          mass: '10 mg',
          testingTier: 'gold',
          additionalTesting: '',
          batchConformity: false,
          capColor: '',
          notes: '',
          participantCount: 0,
          totalOrdered: 0,
        },
      ],
    })))).statusCode, 200);
    assert.equal((await adminHandler(createNetlifyAdminEvent(
      eventBase,
      adminCookie,
      '/api/admin/coas/import-batch',
      'POST',
      {
        rows: [
          createCoaBatchItem('netlify-delete-a', 'HLX-MIA-BPC10-0626-BLUE', 'Blue'),
          createCoaBatchItem('netlify-delete-b', 'HLX-MIA-BPC10-0626-WHITE', 'White'),
          createCoaBatchItem('netlify-delete-keep', 'HLX-MIA-BPC10-0626-KEEP', 'Clear'),
        ],
      },
    ))).statusCode, 200);

    const seedResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/coas',
      rawUrl: 'https://example.netlify.app/api/data/coas',
    });

    assert.equal(seedResponse.statusCode, 200);
    staleCoasBody = blobs.get(coasKey);

    const writeCountBeforeDelete = requests.filter((request) =>
      request.method === 'PUT' && request.key === coasKey
    ).length;
    const deleteResponse = await adminHandler(createNetlifyAdminEvent(
      eventBase,
      adminCookie,
      '/api/admin/coas/delete-batch',
      'POST',
      {
        ids: ['netlify-delete-a', 'netlify-delete-b'],
      },
    ));
    const result = JSON.parse(deleteResponse.body);
    const writeCountAfterDelete = requests.filter((request) =>
      request.method === 'PUT' && request.key === coasKey
    ).length;
    const storedDocument = JSON.parse(blobs.get(coasKey));
    const storedIds = storedDocument.items.map((item) => item.id);

    assert.equal(deleteResponse.statusCode, 200);
    assert.equal(result.deletedCount, 2);
    assert.equal(writeCountAfterDelete, writeCountBeforeDelete + 1);
    assert.equal(storedIds.includes('netlify-delete-a'), false);
    assert.equal(storedIds.includes('netlify-delete-b'), false);
    assert.ok(storedIds.includes('netlify-delete-keep'));
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

test('Netlify COA replacement deletes the detached PDF Blob immediately', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const requests = [];

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    requests.push({ method, key });

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

      if (!blobs.has(key)) {
        return new Response('', { status: 404 });
      }

      return createJsonResponse(blobs.get(key));
    }

    if (method === 'PUT') {
      blobs.set(key, options.body ?? '');
      return new Response('', {
        status: 200,
        headers: { etag: `"${blobs.size}"` },
      });
    }

    if (method === 'DELETE') {
      blobs.delete(key);
      return new Response(null, { status: 204 });
    }

    return new Response('', { status: 405 });
  };

  try {
    const importId = Date.now();
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?coaReplaceBlob=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?coaReplaceBlob=${importId}`);
    const eventBase = createNetlifyBlobsEvent({ includeUncached: false });
    const adminCookie = createAdminSessionCookie('admin');

    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/peptides/bpc-157', 'PUT', {
      id: 'bpc-157',
      name: 'BPC-157',
      kind: 'peptide',
      categories: ['Recovery'],
    }))).statusCode, 200);
    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/rounds/round-coa-batch', 'PUT', createRoundBatchItem({
      id: 'round-coa-batch',
      name: 'Round COA Batch',
      peptides: [
        {
          id: 'round-row-bpc',
          peptideId: 'bpc-157',
          peptideName: 'BPC-157',
          priceListItemId: '',
          vendorCode: 'BPC10',
          vendorPrice: 42,
          vendorPriceOverridden: false,
          mass: '10 mg',
          testingTier: 'gold',
          additionalTesting: '',
          batchConformity: false,
          capColor: '',
          notes: '',
          participantCount: 0,
          totalOrdered: 0,
        },
      ],
    })))).statusCode, 200);

    const firstUploadResponse = await adminHandler(createNetlifyAdminEvent(
      eventBase,
      adminCookie,
      '/api/admin/assets/coa-pdf',
      'POST',
      createCoaPdfUpload('first-netlify-coa.pdf'),
    ));
    const firstAsset = JSON.parse(firstUploadResponse.body);

    assert.equal(firstUploadResponse.statusCode, 200);
    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/coas/netlify-replace-pdf', 'PUT', {
      ...createCoaBatchItem('netlify-replace-pdf', 'HLX-MIA-BPC10-0626-FIRST', 'Blue'),
      ...firstAsset,
    }))).statusCode, 200);

    const firstBlobKey = `/site123/site:helix-data/${firstAsset.coaBlobKey}`;

    assert.equal(blobs.has(firstBlobKey), true);

    const secondUploadResponse = await adminHandler(createNetlifyAdminEvent(
      eventBase,
      adminCookie,
      '/api/admin/assets/coa-pdf',
      'POST',
      createCoaPdfUpload('second-netlify-coa.pdf'),
    ));
    const secondAsset = JSON.parse(secondUploadResponse.body);

    assert.equal(secondUploadResponse.statusCode, 200);
    assert.equal((await adminHandler(createNetlifyAdminEvent(eventBase, adminCookie, '/api/admin/data/coas/netlify-replace-pdf', 'PUT', {
      ...createCoaBatchItem('netlify-replace-pdf', 'HLX-MIA-BPC10-0626-SECOND', 'White'),
      ...secondAsset,
    }))).statusCode, 200);

    assert.equal(blobs.has(firstBlobKey), false);
    assert.ok(requests.some((request) => request.method === 'DELETE' && request.key === firstBlobKey));
    assert.equal(blobs.has(`/site123/site:helix-data/${secondAsset.coaBlobKey}`), true);
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

test('Netlify round batch import writes all rows from one stale Blob snapshot', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const requests = [];
  const roundsKey = '/site123/site:helix-data/rounds.json';
  let staleRoundsBody = null;

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    requests.push({ method, key });

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

      if (key === roundsKey && staleRoundsBody) {
        return createJsonResponse(staleRoundsBody);
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
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?roundBatchBlobs=${importId}`);
    const { handleLambdaEvent: handler } = await import(`../netlify/functions/data.mjs?roundBatchBlobs=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?roundBatchBlobs=${importId}`);
    const eventBase = createNetlifyBlobsEvent({ includeUncached: false });

    const seedResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/rounds',
      rawUrl: 'https://example.netlify.app/api/data/rounds',
    });

    assert.equal(seedResponse.statusCode, 200);
    staleRoundsBody = blobs.get(roundsKey);

    const writeCountBeforeImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === roundsKey
    ).length;
    const importResponse = await adminHandler(createNetlifyAdminEvent(
      eventBase,
      createAdminSessionCookie('admin'),
      '/api/admin/rounds/import-batch',
      'POST',
      {
        rows: [
          createRoundBatchItem({ id: 'netlify-round-a', name: 'Netlify Round A' }),
          createRoundBatchItem({ id: 'netlify-round-b', name: 'Netlify Round B' }),
        ],
      },
    ));
    const result = JSON.parse(importResponse.body);
    const writeCountAfterImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === roundsKey
    ).length;
    const storedDocument = JSON.parse(blobs.get(roundsKey));
    const storedIds = storedDocument.items.map((item) => item.id);

    assert.equal(importResponse.statusCode, 200);
    assert.equal(result.savedCount, 2);
    assert.equal(writeCountAfterImport, writeCountBeforeImport + 1);
    assert.ok(storedIds.includes('netlify-round-a'));
    assert.ok(storedIds.includes('netlify-round-b'));
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

test('Netlify peptide category batch import writes all rows from one stale Blob snapshot', async () => {
  const previousEnv = {
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    NETLIFY: process.env.NETLIFY,
    NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT,
  };
  const previousFetch = globalThis.fetch;
  const previousBlobsContext = globalThis.netlifyBlobsContext;
  const blobs = new Map();
  const requests = [];
  const categoriesKey = '/site123/site:helix-data/peptide-categories.json';
  let staleCategoriesBody = null;

  delete process.env.HELIX_DATA_ADAPTER;
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
  process.env.NETLIFY = 'true';
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestUrl = new URL(url);
    const key = requestUrl.pathname;

    requests.push({ method, key });

    if (method === 'GET') {
      if (requestUrl.searchParams.has('prefix')) {
        return createBlobListResponse(blobs, key, requestUrl.searchParams.get('prefix') ?? '');
      }

      if (key === categoriesKey && staleCategoriesBody) {
        return createJsonResponse(staleCategoriesBody);
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
    const { createAdminSessionCookie } = await import(`../server/helix-auth.mjs?categoryBatchBlobs=${importId}`);
    const { handleLambdaEvent: handler } = await import(`../netlify/functions/data.mjs?categoryBatchBlobs=${importId}`);
    const { handleLambdaEvent: adminHandler } = await import(`../netlify/functions/admin.mjs?categoryBatchBlobs=${importId}`);
    const eventBase = createNetlifyBlobsEvent({ includeUncached: false });

    const seedResponse = await handler({
      ...eventBase,
      httpMethod: 'GET',
      path: '/api/data/peptide-categories',
      rawUrl: 'https://example.netlify.app/api/data/peptide-categories',
    });

    assert.equal(seedResponse.statusCode, 200);
    staleCategoriesBody = blobs.get(categoriesKey);

    const writeCountBeforeImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === categoriesKey
    ).length;
    const importResponse = await adminHandler(createNetlifyAdminEvent(
      eventBase,
      createAdminSessionCookie('admin'),
      '/api/admin/peptide-categories/import-batch',
      'POST',
      {
        rows: [
          { id: 'netlify-category-a', name: 'Netlify Category A' },
          { id: 'netlify-category-b', name: 'Netlify Category B' },
        ],
      },
    ));
    const result = JSON.parse(importResponse.body);
    const writeCountAfterImport = requests.filter((request) =>
      request.method === 'PUT' && request.key === categoriesKey
    ).length;
    const storedDocument = JSON.parse(blobs.get(categoriesKey));
    const storedIds = storedDocument.items.map((item) => item.id);

    assert.equal(importResponse.statusCode, 200);
    assert.equal(result.savedCount, 2);
    assert.equal(writeCountAfterImport, writeCountBeforeImport + 1);
    assert.ok(storedIds.includes('netlify-category-a'));
    assert.ok(storedIds.includes('netlify-category-b'));
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

function createNetlifyAdminEvent(eventBase, adminCookie, path, method, body) {
  return {
    ...eventBase,
    httpMethod: method,
    path,
    rawUrl: `https://example.netlify.app${path}`,
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

function createPeptideBatchRow(rowNumber, id, name) {
  return {
    rowNumber,
    id,
    name,
    kind: 'peptide',
    categories: ['Recovery'],
    description: `${name} description`,
    components: [],
    wikiLinks: [],
    errors: [],
  };
}

function createRoundBatchItem(overrides = {}) {
  return {
    id: 'round-batch',
    name: 'Round Batch',
    status: 'Collecting signups',
    vendorId: 'vendor-one',
    isCurrent: false,
    startDate: '',
    endDate: '',
    targetWindow: '',
    participants: 0,
    roundDiscountPercent: 0,
    priceSourceMode: 'none',
    priceListSnapshot: null,
    peptides: [],
    ...overrides,
  };
}

function createCoaBatchItem(id, batchNumber, capColor) {
  return {
    id,
    roundId: 'round-coa-batch',
    roundName: 'Round COA Batch',
    roundPeptideId: 'round-row-bpc',
    peptideId: 'bpc-157',
    peptideName: 'BPC-157',
    code: 'BPC10',
    batchNumber,
    capColor,
    mass: '10 mg',
    testingTier: 'gold',
    dateTested: '',
    lab: '',
    coaNumber: '',
    accessionNumber: '',
    verificationUrl: '',
    averageNetContent: 'Pending',
    purity: 'Pending',
    endotoxins: 'Pending',
    heavyMetals: 'Pending',
    sterility: 'Pending',
    fentanyl: 'Pending',
  };
}

function createCoaPdfUpload(fileName) {
  return {
    fileName,
    mimeType: 'application/pdf',
    base64: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64'),
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
