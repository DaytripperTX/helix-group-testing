import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';

const testDataDir = path.resolve('.tmp', 'rounds-data-test');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_ADMIN_PASSWORD = 'test-admin-password';
process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const { readCollection } = await import('../server/helix-data.mjs');

test('rounds are public readable and admin writable only', async () => {
  await resetData();

  const publicRead = await apiRequest('/api/data/rounds', 'GET');

  assert.equal(publicRead.statusCode, 200);
  assert.equal(Array.isArray(JSON.parse(publicRead.body)), true);

  const deniedWrite = await apiRequest('/api/admin/data/rounds/public-write-test', 'PUT', createRound({
    id: 'public-write-test',
  }));

  assert.equal(deniedWrite.statusCode, 401);

  const adminCookie = await loginAdmin();
  const adminWrite = await apiRequest('/api/admin/data/rounds/admin-write-test', 'PUT', createRound({
    id: 'admin-write-test',
    name: 'Admin Write Test',
  }), { cookie: adminCookie });

  assert.equal(adminWrite.statusCode, 200);
  assert.ok(JSON.parse(adminWrite.body).some((round) => round.id === 'admin-write-test'));
});

test('round normalization keeps public fields bounded and allowlisted', async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  const longText = 'x'.repeat(600);
  const response = await apiRequest('/api/admin/data/rounds/normalization-test', 'PUT', {
    id: 'normalization-test',
    name: '',
    status: longText,
    vendorId: 'Vendor One!',
    isCurrent: 'true',
    priceSourceMode: 'vendor-default',
    startDate: '2026-06-25',
    endDate: 'not-a-date',
    targetWindow: longText,
    participants: 4.8,
    roundDiscountPercent: 999,
    unknownField: 'drop me',
    priceListSnapshot: {
      id: 'snapshot-1',
      vendorId: 'vendor-one',
      vendorName: longText,
      source: {
        type: 'file',
        fileName: longText,
        mimeType: 'text/csv',
        blobKey: 'assets/vendor-price-sheets/sheet.csv',
        base64: 'should-not-store',
      },
      parsedAt: '2026-06-25T12:30:00.000Z',
      items: [
        {
          id: '',
          vendorCode: longText,
          productName: longText,
          mass: longText,
          price: -12,
          vialsPerPack: 0,
          peptideIds: ['bpc-157', 'bpc-157', '../bad'],
          needsReview: true,
        },
      ],
    },
    peptides: [
      {
        id: '',
        peptideId: '../bad',
        peptideName: longText,
        priceListItemId: '../price',
        vendorCode: longText,
        vendorPrice: -1,
        vendorPriceOverridden: true,
        mass: longText,
        testingTier: 'diamond',
        additionalTesting: longText,
        batchConformity: true,
        capColor: longText,
        notes: longText,
        participantCount: 3.9,
        totalOrdered: '8',
      },
    ],
  }, { cookie: adminCookie });

  assert.equal(response.statusCode, 200);

  const stored = (await readCollection('rounds')).find((round) => round.id === 'normalization-test');

  assert.ok(stored);
  assert.equal(stored.name, 'Untitled round');
  assert.equal(stored.status.length, 120);
  assert.equal(stored.vendorId, 'Vendor-One-');
  assert.equal(stored.isCurrent, false);
  assert.equal(stored.priceSourceMode, 'vendor-default');
  assert.equal(stored.startDate, '06/25/26');
  assert.equal(stored.endDate, '');
  assert.equal(stored.roundDiscountPercent, 100);
  assert.equal(stored.participants, 4);
  assert.equal(stored.unknownField, undefined);
  assert.equal(stored.priceListSnapshot.source.base64, undefined);
  assert.equal(stored.priceListSnapshot.items[0].price, 0);
  assert.equal(stored.priceListSnapshot.items[0].vialsPerPack, 1);
  assert.deepEqual(stored.priceListSnapshot.items[0].peptideIds, ['bpc-157', '..-bad']);
  assert.equal(stored.peptides[0].id, 'row-1');
  assert.equal(stored.peptides[0].testingTier, 'none');
  assert.equal(stored.peptides[0].batchConformity, true);
  assert.equal(stored.peptides[0].vendorPrice, 0);
  assert.equal(stored.peptides[0].participantCount, 3);
  assert.equal(stored.peptides[0].totalOrdered, 8);
});

test('round date normalization accepts common admin date formats', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  const examples = [
    ['slash-short', '6/25/26', '06/25/26'],
    ['slash-long', '06/25/2026', '06/25/26'],
    ['dash-short', '6-25-26', '06/25/26'],
    ['dot-short', '6.25.26', '06/25/26'],
    ['iso', '2026-06-25', '06/25/26'],
    ['month-name', 'June 25, 2026', '06/25/26'],
  ];

  for (const [id, startDate, expectedDate] of examples) {
    const response = await apiRequest('/api/admin/data/rounds/' + id, 'PUT', createRound({
      id,
      startDate,
      endDate: startDate,
    }), { cookie: adminCookie });

    assert.equal(response.statusCode, 200);

    const stored = (await readCollection('rounds')).find((round) => round.id === id);

    assert.equal(stored.startDate, expectedDate);
    assert.equal(stored.endDate, expectedDate);
  }
});

test('multiple current rounds can be stored simultaneously', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await apiRequest('/api/admin/data/rounds/current-a', 'PUT', createRound({
    id: 'current-a',
    name: 'Current A',
    isCurrent: true,
  }), { cookie: adminCookie });
  await apiRequest('/api/admin/data/rounds/current-b', 'PUT', createRound({
    id: 'current-b',
    name: 'Current B',
    isCurrent: true,
  }), { cookie: adminCookie });

  const publicRead = await apiRequest('/api/data/rounds', 'GET');
  const currentRounds = JSON.parse(publicRead.body).filter((round) => round.isCurrent);

  assert.ok(currentRounds.some((round) => round.id === 'current-a'));
  assert.ok(currentRounds.some((round) => round.id === 'current-b'));
});

test('round price snapshots do not overwrite vendor price lists', async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  const vendorPriceList = {
    id: 'vendor-one-price-list',
    vendorId: 'vendor-one',
    vendorName: 'Vendor One',
    source: {
      type: 'google-sheet',
      url: 'https://docs.google.com/spreadsheets/d/test-sheet-id',
    },
    parsedAt: '2026-06-25T12:00:00.000Z',
    items: [
      {
        id: 'price-row-1',
        vendorCode: 'V-001',
        productName: 'BPC-157',
        mass: '10 mg',
        price: 42,
        vialsPerPack: 10,
        peptideIds: ['bpc-157'],
      },
    ],
  };

  await apiRequest('/api/admin/data/vendor-price-lists/vendor-one-price-list', 'PUT', vendorPriceList, {
    cookie: adminCookie,
  });

  await apiRequest('/api/admin/data/rounds/snapshot-round', 'PUT', createRound({
    id: 'snapshot-round',
    name: 'Snapshot Round',
    priceListSnapshot: {
      ...vendorPriceList,
      items: [
        {
          ...vendorPriceList.items[0],
          price: 55,
        },
      ],
    },
  }), { cookie: adminCookie });

  const [storedVendorPriceList] = await readCollection('vendor-price-lists');
  const storedRound = (await readCollection('rounds')).find((round) => round.id === 'snapshot-round');

  assert.equal(storedVendorPriceList.items[0].price, 42);
  assert.equal(storedRound.priceListSnapshot.items[0].price, 55);
});

test('round default price source mode persists after save', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  const response = await apiRequest('/api/admin/data/rounds/default-mode-round', 'PUT', createRound({
    id: 'default-mode-round',
    name: 'Default Mode Round',
    priceSourceMode: 'vendor-default',
    priceListSnapshot: {
      id: 'default-snapshot',
      vendorId: 'vendor-one',
      vendorName: 'Vendor One',
      source: {
        type: 'google-sheet',
        url: 'https://docs.google.com/spreadsheets/d/test-sheet-id',
      },
      parsedAt: '2026-06-25T12:00:00.000Z',
      items: [],
    },
  }), { cookie: adminCookie });

  assert.equal(response.statusCode, 200);

  const storedRound = (await readCollection('rounds')).find((round) => round.id === 'default-mode-round');

  assert.equal(storedRound.priceSourceMode, 'vendor-default');
});

test('round save links dictionary names and clears stale peptide ids', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await apiRequest('/api/admin/data/peptides/ss-31', 'PUT', {
    id: 'ss-31',
    name: 'SS-31 (elamipretide)',
    kind: 'peptide',
    categories: ['Longevity'],
  }, { cookie: adminCookie });

  const response = await apiRequest('/api/admin/data/rounds/dictionary-link-round', 'PUT', createRound({
    id: 'dictionary-link-round',
    peptides: [
      createRoundRow({
        id: 'matched-by-name',
        peptideName: 'SS-31',
      }),
      createRoundRow({
        id: 'unknown-name',
        peptideName: 'Not In Dictionary',
      }),
      createRoundRow({
        id: 'stale-id',
        peptideId: 'missing-peptide',
        peptideName: 'SS-31',
      }),
    ],
  }), { cookie: adminCookie });

  assert.equal(response.statusCode, 200);

  const storedRound = (await readCollection('rounds')).find((round) => round.id === 'dictionary-link-round');
  const matchedRow = storedRound.peptides.find((row) => row.id === 'matched-by-name');
  const unknownRow = storedRound.peptides.find((row) => row.id === 'unknown-name');
  const staleRow = storedRound.peptides.find((row) => row.id === 'stale-id');

  assert.equal(matchedRow.peptideId, 'ss-31');
  assert.equal(matchedRow.peptideName, 'SS-31 (elamipretide)');
  assert.equal(unknownRow.peptideId, '');
  assert.equal(unknownRow.peptideName, 'Not In Dictionary');
  assert.equal(staleRow.peptideId, '');
  assert.equal(staleRow.peptideName, 'SS-31');
});

test('round peptide batch parse imports linked rows with batch conformity', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await apiRequest('/api/admin/data/peptides/ss-31', 'PUT', {
    id: 'ss-31',
    name: 'SS-31 (elamipretide)',
    kind: 'peptide',
    categories: ['Longevity'],
  }, { cookie: adminCookie });

  const response = await apiRequest('/api/admin/rounds/parse-peptides', 'POST', {
    source: {
      type: 'file',
      fileName: 'round-peptides.csv',
      text: [
        'Peptide Name,Supplier Code,Price,MG,Tier,Additional testing,Batch conformity,Cap color,Headcount,Total Order Qty,Notes',
        'BPC-157,BPC10,66,10 mg,Platinum,Fentanyl,yes,Blue,26,82,Priority',
        'SS-31,SS31,88,5 mg,Gold,,,,0,0,Parenthetical match',
        'Not In Dictionary,UNK,12,2 mg,None,,,,0,0,Keep unlinked',
        'Bac Water,BAC30,4,30 ml,None,,,,0,0,Keep units',
      ].join('\n'),
    },
    priceListItems: [
      {
        id: 'price-bpc10',
        vendorCode: 'BPC10',
        productName: 'BPC-157',
        mass: '10 mg',
        price: 66,
        peptideIds: ['bpc-157'],
      },
    ],
    existingRows: [],
  }, { cookie: adminCookie });

  assert.equal(response.statusCode, 200);

  const [row, ss31Row, unknownRow, bacWaterRow] = JSON.parse(response.body).rows;

  assert.equal(row.peptideId, 'bpc-157');
  assert.equal(row.priceListItemId, 'price-bpc10');
  assert.equal(row.vendorCode, 'BPC10');
  assert.equal(row.vendorPrice, 66);
  assert.equal(row.mass, '10');
  assert.equal(row.testingTier, 'platinum');
  assert.equal(row.batchConformity, true);
  assert.equal(row.participantCount, 26);
  assert.equal(row.totalOrdered, 82);
  assert.deepEqual(row.errors, []);
  assert.equal(ss31Row.peptideId, 'ss-31');
  assert.equal(ss31Row.peptideName, 'SS-31 (elamipretide)');
  assert.deepEqual(ss31Row.errors, []);
  assert.equal(unknownRow.peptideId, '');
  assert.equal(unknownRow.peptideName, 'Not In Dictionary');
  assert.deepEqual(unknownRow.errors, []);
  assert.equal(bacWaterRow.peptideName, 'Bac Water');
  assert.equal(bacWaterRow.mass, '30 ml');
  assert.equal(bacWaterRow.testingTier, 'none');
  assert.deepEqual(bacWaterRow.errors, []);
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

function apiRequest(pathname, method, body, options = {}) {
  return handleHelixApiRequest({
    method,
    pathname,
    url: pathname,
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      'user-agent': 'rounds-data-test',
      'x-forwarded-for': '198.51.100.10',
    },
    bodyText: body === undefined ? '' : JSON.stringify(body),
  });
}

function createRound(overrides = {}) {
  return {
    id: 'round-test',
    name: 'Round Test',
    status: 'Collecting signups',
    vendorId: 'vendor-one',
    isCurrent: false,
    startDate: '',
    endDate: '',
    targetWindow: 'Testing window',
    participants: 0,
    roundDiscountPercent: 0,
    priceSourceMode: 'none',
    priceListSnapshot: null,
    peptides: [],
    ...overrides,
  };
}

function createRoundRow(overrides = {}) {
  return {
    id: 'row-test',
    peptideId: '',
    peptideName: 'BPC-157',
    priceListItemId: '',
    vendorCode: '',
    vendorPrice: null,
    vendorPriceOverridden: false,
    mass: '',
    testingTier: 'none',
    additionalTesting: '',
    batchConformity: false,
    capColor: '',
    notes: '',
    participantCount: 0,
    totalOrdered: 0,
    ...overrides,
  };
}
