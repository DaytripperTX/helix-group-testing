import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';

const testDataDir = path.resolve('.tmp', 'coas-data-test');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_ADMIN_PASSWORD = 'test-admin-password';
process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';
process.env.HELIX_DATA_ADAPTER = 'local';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const { readCollection } = await import('../server/helix-data.mjs');

test('coas are public readable and admin writable only', async () => {
  await resetData();

  const publicRead = await apiRequest('/api/data/coas', 'GET');
  const deniedWrite = await apiRequest('/api/admin/data/coas/public-write-test', 'PUT', createCoa());

  assert.equal(publicRead.statusCode, 200);
  assert.equal(Array.isArray(JSON.parse(publicRead.body)), true);
  assert.equal(deniedWrite.statusCode, 401);
});

test('coa entries link to round peptides and keep one row per batch', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await seedRound(adminCookie);

  const firstResponse = await apiRequest('/api/admin/data/coas/batch-blue', 'PUT', createCoa({
    id: 'batch-blue',
    batchNumber: 'HLX-MIA-BPC10-0626-BLUE',
    capColor: 'Blue',
    mass: 'wrong mass',
    testingTier: 'bronze',
  }), { cookie: adminCookie });
  const secondResponse = await apiRequest('/api/admin/data/coas/batch-white', 'PUT', createCoa({
    id: 'batch-white',
    batchNumber: 'HLX-MIA-BPC10-0626-WHITE',
    capColor: 'White',
  }), { cookie: adminCookie });

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);

  const storedCoas = await readCollection('coas');
  const firstCoa = storedCoas.find((coa) => coa.id === 'batch-blue');
  const secondCoa = storedCoas.find((coa) => coa.id === 'batch-white');

  assert.equal(firstCoa.roundName, 'Round Test');
  assert.equal(firstCoa.peptideId, 'bpc-157');
  assert.equal(firstCoa.peptideName, 'BPC-157');
  assert.equal(firstCoa.code, 'BPC10');
  assert.equal(firstCoa.mass, '10 mg');
  assert.equal(firstCoa.testingTier, 'gold');
  assert.equal(secondCoa.roundPeptideId, 'round-row-bpc');
  assert.equal(secondCoa.code, 'BPC10');
});

test('coa admin writes reject unlinked new entries', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  const response = await apiRequest('/api/admin/data/coas/unlinked', 'PUT', {
    ...createCoa({ id: 'unlinked' }),
    roundId: '',
    roundPeptideId: '',
    peptideId: '',
    code: '',
  }, { cookie: adminCookie });

  assert.equal(response.statusCode, 400);
});

test('coa pdf uploads are admin only, pdf only, and publicly served when attached', async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  await seedRound(adminCookie);

  const unauthenticatedUpload = await apiRequest('/api/admin/assets/coa-pdf', 'POST', createPdfUpload());
  const invalidUpload = await apiRequest('/api/admin/assets/coa-pdf', 'POST', {
    fileName: 'not-pdf.txt',
    mimeType: 'text/plain',
    base64: Buffer.from('not a pdf').toString('base64'),
  }, { cookie: adminCookie });
  const validUpload = await apiRequest('/api/admin/assets/coa-pdf', 'POST', createPdfUpload(), { cookie: adminCookie });

  assert.equal(unauthenticatedUpload.statusCode, 401);
  assert.equal(invalidUpload.statusCode, 400);
  assert.equal(validUpload.statusCode, 200);

  const asset = JSON.parse(validUpload.body);
  const saveResponse = await apiRequest('/api/admin/data/coas/batch-with-pdf', 'PUT', {
    ...createCoa({
      id: 'batch-with-pdf',
      batchNumber: 'HLX-MIA-BPC10-0626-PDF',
    }),
    ...asset,
  }, { cookie: adminCookie });

  assert.equal(saveResponse.statusCode, 200);

  const pdfResponse = await apiRequest('/api/coas/batch-with-pdf/pdf', 'GET');
  const missingPdfResponse = await apiRequest('/api/coas/missing/pdf', 'GET');

  assert.equal(pdfResponse.statusCode, 200);
  assert.equal(pdfResponse.headers['Content-Type'], 'application/pdf');
  assert.equal(Buffer.from(pdfResponse.body, 'base64').subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(missingPdfResponse.statusCode, 404);
});

test('coa batch number parser maps spreadsheet rows for admin imports', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  const response = await apiRequest('/api/admin/coas/parse-batch-numbers', 'POST', {
    source: {
      fileName: 'coa-batches.csv',
      text: [
        'Peptide,Batch #,Code,Cap Color',
        'SS-31,HLX-MIA-2S10-0626-BLUE,2S10,Blue',
        'SS-31,HLX-MIA-2S10-0626-WHITE,2S10,White',
      ].join('\n'),
    },
  }, { cookie: adminCookie });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).rows, [
    {
      peptideName: 'SS-31',
      batchNumber: 'HLX-MIA-2S10-0626-BLUE',
      code: '2S10',
      capColor: 'Blue',
    },
    {
      peptideName: 'SS-31',
      batchNumber: 'HLX-MIA-2S10-0626-WHITE',
      code: '2S10',
      capColor: 'White',
    },
  ]);
});

async function resetData() {
  await rm(testDataDir, { recursive: true, force: true });
}

async function loginAdmin() {
  const response = await apiRequest('/api/admin/login', 'POST', {
    role: 'admin',
    password: process.env.HELIX_ADMIN_PASSWORD,
  });

  assert.equal(response.statusCode, 200);
  return response.headers['Set-Cookie'];
}

async function seedRound(adminCookie) {
  await apiRequest('/api/admin/data/peptides/bpc-157', 'PUT', {
    id: 'bpc-157',
    name: 'BPC-157',
    kind: 'peptide',
    categories: ['Recovery'],
  }, { cookie: adminCookie });

  await apiRequest('/api/admin/data/rounds/round-test', 'PUT', {
    id: 'round-test',
    name: 'Round Test',
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
  }, { cookie: adminCookie });
}

function createCoa(overrides = {}) {
  return {
    id: 'batch-test',
    roundId: 'round-test',
    roundName: '',
    roundPeptideId: 'round-row-bpc',
    peptideId: 'bpc-157',
    peptideName: '',
    code: 'BPC10',
    batchNumber: 'HLX-MIA-BPC10-0626',
    capColor: 'Blue',
    mass: '',
    testingTier: 'none',
    dateTested: '',
    averageNetContent: 'Pending',
    purity: 'Pending',
    endotoxins: 'Pending',
    heavyMetals: 'Pending',
    sterility: 'Pending',
    ...overrides,
  };
}

function createPdfUpload() {
  return {
    fileName: 'coa.pdf',
    mimeType: 'application/pdf',
    base64: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64'),
  };
}

function apiRequest(pathname, method, body, options = {}) {
  return handleHelixApiRequest({
    method,
    pathname,
    url: pathname,
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      'user-agent': 'coas-data-test',
      'x-forwarded-for': '198.51.100.20',
    },
    bodyText: body === undefined ? '' : JSON.stringify(body),
  });
}
