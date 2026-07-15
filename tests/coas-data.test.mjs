import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
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
  const netlifyPublicRead = await apiRequest('/.netlify/functions/data/coas', 'GET');
  const deniedWrite = await apiRequest('/api/admin/data/coas/public-write-test', 'PUT', createCoa());

  assert.equal(publicRead.statusCode, 200);
  assert.equal(Array.isArray(JSON.parse(publicRead.body)), true);
  assert.equal(netlifyPublicRead.statusCode, 200);
  assert.equal(Array.isArray(JSON.parse(netlifyPublicRead.body)), true);
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

test('public COA reads keep no-passcode round results visible', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await seedRound(adminCookie);

  const saveResponse = await apiRequest('/api/admin/data/coas/public-visible', 'PUT', createCoa({
    id: 'public-visible',
    averageNetContent: '10.2 mg',
    purity: '99.1%',
    endotoxins: 'Pass',
    fentanyl: 'Pass',
  }), { cookie: adminCookie });
  const publicRead = await apiRequest('/api/data/coas', 'GET');
  const publicCoa = JSON.parse(publicRead.body).find((coa) => coa.id === 'public-visible');

  assert.equal(saveResponse.statusCode, 200);
  assert.equal(publicCoa.isResultLocked, false);
  assert.equal(publicCoa.averageNetContent, '10.2 mg');
  assert.equal(publicCoa.purity, '99.1%');
  assert.equal(publicCoa.endotoxins, 'Pass');
  assert.equal(publicCoa.fentanyl, 'Pass');
});

test('round passcode gates public COA results and document assets', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await seedRound(adminCookie, { resultPasscode: 'round-secret' });

  const asset = JSON.parse((await apiRequest('/api/admin/assets/coa-pdf', 'POST', createPdfUpload(), {
    cookie: adminCookie,
  })).body);
  const saveResponse = await apiRequest('/api/admin/data/coas/locked-coa', 'PUT', {
    ...createCoa({
      id: 'locked-coa',
      averageNetContent: '10.2 mg',
      purity: '99.1%',
      endotoxins: 'Pass',
      fentanyl: 'Pass',
      coaNumber: 'COA-LOCKED',
      accessionNumber: 'ACC-LOCKED',
      verificationUrl: 'https://example.test/verify',
    }),
    ...asset,
  }, { cookie: adminCookie });

  assert.equal(saveResponse.statusCode, 200);

  const publicRead = await apiRequest('/api/data/coas', 'GET');
  const adminRead = await apiRequest('/api/data/coas', 'GET', undefined, { cookie: adminCookie });
  const lockedPublicCoa = JSON.parse(publicRead.body).find((coa) => coa.id === 'locked-coa');
  const adminCoa = JSON.parse(adminRead.body).find((coa) => coa.id === 'locked-coa');

  assert.equal(lockedPublicCoa.isResultLocked, true);
  assert.equal(lockedPublicCoa.hasRoundPasscode, true);
  assert.equal(lockedPublicCoa.averageNetContent, undefined);
  assert.equal(lockedPublicCoa.purity, undefined);
  assert.equal(lockedPublicCoa.fentanyl, undefined);
  assert.equal(lockedPublicCoa.coaNumber, undefined);
  assert.equal(lockedPublicCoa.accessionNumber, undefined);
  assert.equal(lockedPublicCoa.verificationUrl, undefined);
  assert.equal(lockedPublicCoa.coaBlobKey, undefined);
  assert.equal(lockedPublicCoa.parsedCoa, undefined);
  assert.equal(adminCoa.averageNetContent, '10.2 mg');
  assert.equal(adminCoa.coaBlobKey, asset.coaBlobKey);

  const lockedPdfResponse = await apiRequest('/api/coas/locked-coa/pdf', 'GET');
  const wrongPasscodeResponse = await apiRequest('/api/coas/round-passcode', 'POST', {
    roundId: 'round-test',
    passcode: 'wrong',
  });
  const unlockResponse = await apiRequest('/api/coas/round-passcode', 'POST', {
    roundId: 'round-test',
    passcode: 'round-secret',
  });
  const unlockCookie = unlockResponse.headers['Set-Cookie'];
  const unlockedRead = await apiRequest('/api/data/coas', 'GET', undefined, { cookie: unlockCookie });
  const unlockedPdfResponse = await apiRequest('/api/coas/locked-coa/pdf', 'GET', undefined, { cookie: unlockCookie });
  const unlockedCoa = JSON.parse(unlockedRead.body).find((coa) => coa.id === 'locked-coa');

  assert.equal(lockedPdfResponse.statusCode, 403);
  assert.equal(wrongPasscodeResponse.statusCode, 401);
  assert.equal(unlockResponse.statusCode, 200);
  assert.match(unlockCookie, /helix_coa_round_access=/);
  assert.equal(unlockedCoa.isResultLocked, false);
  assert.equal(unlockedCoa.averageNetContent, '10.2 mg');
  assert.equal(unlockedCoa.coaBlobKey, asset.coaBlobKey);
  assert.equal(unlockedPdfResponse.statusCode, 200);
  assert.equal(unlockedPdfResponse.headers['Cache-Control'], 'private, no-cache');
});

test('coa batch import saves multiple entries in one request', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await seedRound(adminCookie);

  const response = await apiRequest('/api/admin/coas/import-batch', 'POST', {
    rows: [
      createCoa({
        id: 'batch-import-blue',
        batchNumber: 'HLX-MIA-BPC10-0626-BLUE',
        capColor: 'Blue',
      }),
      createCoa({
        id: 'batch-import-white',
        batchNumber: 'HLX-MIA-BPC10-0626-WHITE',
        capColor: 'White',
      }),
    ],
  }, { cookie: adminCookie });
  const result = JSON.parse(response.body);
  const storedCoas = await readCollection('coas');

  assert.equal(response.statusCode, 200);
  assert.equal(result.savedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.ok(storedCoas.some((coa) => coa.id === 'batch-import-blue'));
  assert.ok(storedCoas.some((coa) => coa.id === 'batch-import-white'));
});

test('coa batch delete removes multiple entries in one request', async () => {
  await resetData();
  const adminCookie = await loginAdmin();

  await seedRound(adminCookie);
  await apiRequest('/api/admin/coas/import-batch', 'POST', {
    rows: [
      createCoa({
        id: 'batch-delete-blue',
        batchNumber: 'HLX-MIA-BPC10-0626-BLUE',
        capColor: 'Blue',
      }),
      createCoa({
        id: 'batch-delete-white',
        batchNumber: 'HLX-MIA-BPC10-0626-WHITE',
        capColor: 'White',
      }),
      createCoa({
        id: 'batch-delete-keep',
        batchNumber: 'HLX-MIA-BPC10-0626-KEEP',
        capColor: 'Clear',
      }),
    ],
  }, { cookie: adminCookie });

  const response = await apiRequest('/api/admin/coas/delete-batch', 'POST', {
    ids: ['batch-delete-blue', 'batch-delete-white'],
  }, { cookie: adminCookie });
  const result = JSON.parse(response.body);
  const storedCoas = await readCollection('coas');

  assert.equal(response.statusCode, 200);
  assert.equal(result.deletedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.equal(storedCoas.some((coa) => coa.id === 'batch-delete-blue'), false);
  assert.equal(storedCoas.some((coa) => coa.id === 'batch-delete-white'), false);
  assert.ok(storedCoas.some((coa) => coa.id === 'batch-delete-keep'));
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
  const netlifyPdfResponse = await apiRequest('/.netlify/functions/data/coas/batch-with-pdf/pdf', 'GET');
  const missingPdfResponse = await apiRequest('/api/coas/missing/pdf', 'GET');

  assert.equal(pdfResponse.statusCode, 200);
  assert.equal(pdfResponse.headers['Content-Type'], 'application/pdf');
  assert.equal(Buffer.from(pdfResponse.body, 'base64').subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(netlifyPdfResponse.statusCode, 200);
  assert.equal(netlifyPdfResponse.headers['Content-Type'], 'application/pdf');
  assert.equal(Buffer.from(netlifyPdfResponse.body, 'base64').subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(missingPdfResponse.statusCode, 404);
});

test('replacing and deleting COA PDFs removes detached stored PDF assets', async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  await seedRound(adminCookie);

  const firstUpload = JSON.parse((await apiRequest('/api/admin/assets/coa-pdf', 'POST', createPdfUpload({
    fileName: 'first-coa.pdf',
  }), { cookie: adminCookie })).body);
  const firstSave = await apiRequest('/api/admin/data/coas/replaced-pdf', 'PUT', {
    ...createCoa({
      id: 'replaced-pdf',
      batchNumber: 'HLX-MIA-BPC10-0626-FIRST',
    }),
    ...firstUpload,
  }, { cookie: adminCookie });

  assert.equal(firstSave.statusCode, 200);
  assert.equal(existsSync(path.join(testDataDir, firstUpload.coaBlobKey)), true);

  const secondUpload = JSON.parse((await apiRequest('/api/admin/assets/coa-pdf', 'POST', createPdfUpload({
    fileName: 'second-coa.pdf',
  }), { cookie: adminCookie })).body);
  const secondSave = await apiRequest('/api/admin/data/coas/replaced-pdf', 'PUT', {
    ...createCoa({
      id: 'replaced-pdf',
      batchNumber: 'HLX-MIA-BPC10-0626-SECOND',
    }),
    ...secondUpload,
  }, { cookie: adminCookie });

  assert.equal(secondSave.statusCode, 200);
  assert.equal(existsSync(path.join(testDataDir, firstUpload.coaBlobKey)), false);
  assert.equal(existsSync(path.join(testDataDir, secondUpload.coaBlobKey)), true);

  const deleteResponse = await apiRequest('/api/admin/data/coas/replaced-pdf', 'DELETE', undefined, { cookie: adminCookie });

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(existsSync(path.join(testDataDir, secondUpload.coaBlobKey)), false);
});

const sampleCoaFixturePath = resolveLocalCoaFixture('CR-3XAG-30MG-2606-2.pdf');
const missingVialCoaFixturePath = resolveLocalCoaFixture('HLX-SOP-CP10-2PEP.pdf');

test('coa pdf identification reads the batch number without relying on the filename', { skip: !missingVialCoaFixturePath }, async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  const upload = await createFixturePdfUpload('HLX-SOP-CP10-2PEP.pdf');
  upload.fileName = 'unrelated-lab-document.pdf';

  const deniedResponse = await apiRequest('/api/admin/assets/coa-pdf-identify', 'POST', upload);
  const response = await apiRequest('/api/admin/assets/coa-pdf-identify', 'POST', upload, { cookie: adminCookie });
  const result = JSON.parse(response.body);

  assert.equal(deniedResponse.statusCode, 401);
  assert.equal(response.statusCode, 200);
  assert.equal(result.batchNumber, 'HLX-SOP-CP10-2PEP');
  assert.equal(result.coaBlobKey, undefined);
});

test('coa pdf uploads preserve quantitative endotoxin results without requiring a vial image', { skip: !missingVialCoaFixturePath }, async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  await seedRound(adminCookie);

  const uploadResponse = await apiRequest(
    '/api/admin/assets/coa-pdf',
    'POST',
    await createFixturePdfUpload('HLX-SOP-CP10-2PEP.pdf'),
    { cookie: adminCookie },
  );
  const asset = JSON.parse(uploadResponse.body);

  assert.equal(uploadResponse.statusCode, 200);
  assert.equal(asset.parsedCoa.fields.averageNetContent, '10.17 mg');
  assert.equal(asset.parsedCoa.fields.endotoxins, 'Pass');
  assert.equal(asset.parsedCoa.fields.endotoxinResult, '0.096 EU/mL');
  assert.equal(asset.parsedCoa.fields.endotoxinThreshold, '5 EU/mL');
  assert.equal(asset.vialImageAssetKey, undefined);
  assert.equal(asset.parsedCoa.raw.vialImage, null);

  const saveResponse = await apiRequest('/api/admin/data/coas/quantitative-no-vial', 'PUT', {
    ...createCoa({
      id: 'quantitative-no-vial',
      batchNumber: asset.parsedCoa.fields.lotNumber,
      averageNetContent: asset.parsedCoa.fields.averageNetContent,
      endotoxins: asset.parsedCoa.fields.endotoxins,
    }),
    ...asset,
  }, { cookie: adminCookie });
  const stored = (await readCollection('coas')).find((coa) => coa.id === 'quantitative-no-vial');

  assert.equal(saveResponse.statusCode, 200);
  assert.equal(stored.endotoxins, 'Pass');
  assert.equal(stored.parsedCoa.fields.endotoxinResult, '0.096 EU/mL');
  assert.equal(stored.vialImageAssetKey, undefined);
});

test('coa pdf uploads return parsed payload and stored entries preserve parsed fields', { skip: !sampleCoaFixturePath }, async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  await seedRound(adminCookie);

  const uploadResponse = await apiRequest('/api/admin/assets/coa-pdf', 'POST', await createFixturePdfUpload('CR-3XAG-30MG-2606-2.pdf'), {
    cookie: adminCookie,
  });

  assert.equal(uploadResponse.statusCode, 200);

  const asset = JSON.parse(uploadResponse.body);

  assert.equal(asset.parsedCoa.templateId, 'ils_laboratories_coa');
  assert.equal(asset.parsedCoa.fields.lotNumber, 'CR-3XAG-30MG-2606-2');
  assert.ok(asset.parsedCoa.fields.identityConfirmation);
  assert.equal(asset.parsedCoa.fields.purity, '99.85%');
  assert.equal(asset.parsedCoa.fields.averageNetContent, '31.71 mg');
  assert.ok(asset.parsedCoa.fields.verificationUrl.endsWith('/2qgRtQeSmLEps64L'));
  assert.match(asset.vialImageAssetKey, /^coa-vial-images\/.+\.png$/);
  assert.equal(asset.vialImageMimeType, 'image/png');
  assert.equal(asset.vialImageSource, 'coa-pdf');
  assert.equal(asset.vialImageMode, 'extracted');
  assert.equal(asset.parsedCoa.raw.vialImage.width, 560);
  assert.equal(asset.parsedCoa.raw.vialImage.height, 560);
  assert.equal(asset.parsedCoa.raw.vialImage.imageName, 'img_p0_5');
  assert.equal(asset.parsedCoa.raw.vialImage.operatorIndex, 316);

  const saveResponse = await apiRequest('/api/admin/data/coas/parsed-coa', 'PUT', {
    ...createCoa({
      id: 'parsed-coa',
      batchNumber: asset.parsedCoa.fields.lotNumber,
    }),
    ...asset,
    lab: asset.parsedCoa.fields.lab,
    coaNumber: asset.parsedCoa.fields.coaNumber,
    accessionNumber: asset.parsedCoa.fields.accessionNumber,
    dateTested: asset.parsedCoa.fields.analysisDate,
    averageNetContent: asset.parsedCoa.fields.averageNetContent,
    purity: asset.parsedCoa.fields.purity,
    endotoxins: asset.parsedCoa.fields.endotoxins,
    heavyMetals: asset.parsedCoa.fields.heavyMetals,
    sterility: asset.parsedCoa.fields.sterility,
    fentanyl: asset.parsedCoa.fields.fentanyl,
    verificationUrl: asset.parsedCoa.fields.verificationUrl,
  }, { cookie: adminCookie });

  assert.equal(saveResponse.statusCode, 200);

  const stored = (await readCollection('coas')).find((coa) => coa.id === 'parsed-coa');

  assert.equal(stored.lab, 'ILS Laboratories');
  assert.equal(stored.coaNumber, 'COA-2026-O1Y8QY');
  assert.equal(stored.accessionNumber, 'ACC-2026-5031');
  assert.equal(stored.dateTested, '2026-06-26');
  assert.equal(stored.averageNetContent, '31.71 mg');
  assert.equal(stored.purity, '99.85%');
  assert.equal(stored.endotoxins, 'Pass');
  assert.equal(stored.heavyMetals, 'Pass');
  assert.equal(stored.sterility, 'Pass');
  assert.equal(stored.fentanyl, 'Pass');
  assert.ok(stored.verificationUrl.endsWith('/2qgRtQeSmLEps64L'));
  assert.equal(stored.parsedCoa.fields.identityConfirmation, asset.parsedCoa.fields.identityConfirmation);
  assert.equal(stored.parsedCoa.fields.lotNumber, 'CR-3XAG-30MG-2606-2');
  assert.equal(stored.vialImageAssetKey, asset.vialImageAssetKey);
  assert.equal(stored.vialImageMode, 'extracted');

  const activeImageResponse = await apiRequest('/api/coas/parsed-coa/vial-image', 'GET');

  assert.equal(activeImageResponse.statusCode, 200);
  assert.equal(activeImageResponse.headers['Content-Type'], 'image/png');
  assert.equal(Buffer.from(activeImageResponse.body, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  const placeholderResponse = await apiRequest('/api/admin/data/coas/parsed-coa', 'PUT', {
    ...stored,
    vialImageMode: 'placeholder',
  }, { cookie: adminCookie });

  assert.equal(placeholderResponse.statusCode, 200);

  const hiddenImageResponse = await apiRequest('/api/coas/parsed-coa/vial-image', 'GET');

  assert.equal(hiddenImageResponse.statusCode, 404);

  const [placeholderCoa] = JSON.parse(placeholderResponse.body).filter((coa) => coa.id === 'parsed-coa');
  const restoredResponse = await apiRequest('/api/admin/data/coas/parsed-coa', 'PUT', {
    ...placeholderCoa,
    vialImageMode: 'extracted',
  }, { cookie: adminCookie });

  assert.equal(restoredResponse.statusCode, 200);

  const restoredCoa = (await readCollection('coas')).find((coa) => coa.id === 'parsed-coa');
  const restoredImageResponse = await apiRequest('/api/coas/parsed-coa/vial-image', 'GET');

  assert.equal(restoredCoa.vialImageAssetKey, asset.vialImageAssetKey);
  assert.equal(restoredCoa.vialImageMode, 'extracted');
  assert.equal(restoredImageResponse.statusCode, 200);
});

test('coa admin writes reject parsed payloads for a different lot', { skip: !sampleCoaFixturePath }, async () => {
  await resetData();
  const adminCookie = await loginAdmin();
  await seedRound(adminCookie);

  const uploadResponse = await apiRequest('/api/admin/assets/coa-pdf', 'POST', await createFixturePdfUpload('CR-3XAG-30MG-2606-2.pdf'), {
    cookie: adminCookie,
  });
  const asset = JSON.parse(uploadResponse.body);
  const saveResponse = await apiRequest('/api/admin/data/coas/mismatched-parsed-coa', 'PUT', {
    ...createCoa({
      id: 'mismatched-parsed-coa',
      batchNumber: 'CR-MOTSC40-2606-BLUE',
    }),
    ...asset,
  }, { cookie: adminCookie });

  assert.equal(saveResponse.statusCode, 400);
  assert.match(JSON.parse(saveResponse.body).error, /lot does not match/i);
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

async function seedRound(adminCookie, roundOverrides = {}) {
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
    ...roundOverrides,
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

function createPdfUpload(overrides = {}) {
  return {
    fileName: 'coa.pdf',
    mimeType: 'application/pdf',
    base64: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64'),
    ...overrides,
  };
}

async function createFixturePdfUpload(fileName) {
  return {
    fileName,
    mimeType: 'application/pdf',
    base64: (await readFile(resolveLocalCoaFixture(fileName))).toString('base64'),
  };
}

function resolveLocalCoaFixture(fileName) {
  const candidates = [
    path.join('.tmp', 'coa-fixtures', fileName),
    path.join(process.env.USERPROFILE || '', 'Downloads', fileName),
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) || '';
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
