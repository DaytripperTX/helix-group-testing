import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { parseVendorPriceList } from '../server/vendor-price-list-parser.mjs';
import { xlsxFixtureBase64 } from './fixtures/spreadsheet-fixtures.mjs';

const originalFetch = globalThis.fetch;
const csvBody = [
  'code,product,price',
  'BPC,BPC-157,42',
].join('\n');

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('google sheet parser rejects non-Google URLs before fetch', async () => {
  for (const url of [
    'http://127.0.0.1/admin',
    'https://example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345',
    'http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345',
    'https://docs.google.com.evil.test/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345',
    'not a valid url',
    'https://docs.google.com/',
  ]) {
    const fetchCalls = [];
    globalThis.fetch = async (fetchUrl) => {
      fetchCalls.push(String(fetchUrl));
      return createCsvResponse();
    };

    await assert.rejects(
      () => parseGoogleSheetUrl(url),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /Google Sheet URL/);
        return true;
      },
    );

    assert.deepEqual(fetchCalls, [], `${url} should not be fetched`);
  }
});

test('google sheet parser converts raw Sheet ids to docs CSV export URLs', async () => {
  const fetchCalls = await parseWithFetchCapture('1AbCdEfGhIjKlMnOpQrStUvWxYz_12345');

  assert.deepEqual(fetchCalls, [
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/export?format=csv&gid=0',
  ]);
});

test('google sheet parser converts docs edit URLs to docs CSV export URLs', async () => {
  const fetchCalls = await parseWithFetchCapture(
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/edit?usp=sharing',
  );

  assert.deepEqual(fetchCalls, [
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/export?format=csv&gid=0',
  ]);
});

test('google sheet parser preserves gid from query or hash', async () => {
  const queryCalls = await parseWithFetchCapture(
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/edit?gid=456',
  );
  const hashCalls = await parseWithFetchCapture(
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/edit#gid=789',
  );

  assert.deepEqual(queryCalls, [
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/export?format=csv&gid=456',
  ]);
  assert.deepEqual(hashCalls, [
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/export?format=csv&gid=789',
  ]);
});

test('vendor price parser reads CSV file uploads', async () => {
  const result = await parseVendorPriceList({
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    source: {
      type: 'file',
      fileName: 'price-list.csv',
      mimeType: 'text/csv',
      base64: Buffer.from(csvBody).toString('base64'),
    },
    peptides: [{ id: 'bpc-157', name: 'BPC-157' }],
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].vendorCode, 'BPC');
  assert.equal(result.items[0].productName, 'BPC-157');
  assert.equal(result.items[0].price, 42);
  assert.deepEqual(result.items[0].peptideIds, ['bpc-157']);
});

test('vendor price parser reads XLSX file uploads', async () => {
  const result = await parseVendorPriceList({
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    source: {
      type: 'file',
      fileName: 'price-list.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: xlsxFixtureBase64,
    },
    peptides: [{ id: 'bpc-157', name: 'BPC-157' }],
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].vendorCode, 'BPC');
  assert.equal(result.items[0].productName, 'BPC-157');
  assert.equal(result.items[0].price, 42);
  assert.deepEqual(result.items[0].peptideIds, ['bpc-157']);
});

test('vendor price parser links peptide names by partial parenthetical match', async () => {
  const result = await parseVendorPriceList({
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    source: {
      type: 'file',
      fileName: 'price-list.csv',
      mimeType: 'text/csv',
      base64: Buffer.from('code,product,price\n2S10,SS-31,100').toString('base64'),
    },
    peptides: [{ id: 'ss-31', name: 'SS-31 (elamipretide)' }],
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].peptideIds, ['ss-31']);
});

async function parseWithFetchCapture(url) {
  const fetchCalls = [];
  globalThis.fetch = async (fetchUrl) => {
    fetchCalls.push(String(fetchUrl));
    return createCsvResponse();
  };

  const result = await parseGoogleSheetUrl(url);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].vendorCode, 'BPC');
  assert.equal(result.items[0].productName, 'BPC-157');

  return fetchCalls;
}

function parseGoogleSheetUrl(url) {
  return parseVendorPriceList({
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    source: {
      type: 'google-sheet',
      url,
    },
    peptides: [
      {
        id: 'bpc-157',
        name: 'BPC-157',
      },
    ],
  });
}

function createCsvResponse() {
  return {
    ok: true,
    text: async () => csvBody,
  };
}
