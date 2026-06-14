import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readSpreadsheetRows } from '../server/spreadsheet-reader.mjs';
import { xlsxFixtureBase64 } from './fixtures/spreadsheet-fixtures.mjs';

test('spreadsheet reader parses CSV rows', async () => {
  const rows = await readSpreadsheetRows({
    fileName: 'sheet.csv',
    text: 'code,product,price\nBPC,BPC-157,42',
  });

  assert.deepEqual(rows, [
    ['code', 'product', 'price'],
    ['BPC', 'BPC-157', '42'],
  ]);
});

test('spreadsheet reader parses XLSX rows', async () => {
  const rows = await readSpreadsheetRows({
    fileName: 'sheet.xlsx',
    base64: xlsxFixtureBase64,
  });

  assert.deepEqual(rows, [
    ['code', 'product', 'price'],
    ['BPC', 'BPC-157', '42'],
  ]);
});

test('spreadsheet reader rejects legacy and unknown file formats', async () => {
  for (const fileName of ['sheet.xls', 'sheet.xlsb', 'sheet.xlsm', 'sheet.txt']) {
    await assertRejectsSpreadsheet({ fileName, text: 'code,product\nBPC,BPC-157' }, /CSV or XLSX/);
  }
});

test('spreadsheet reader rejects oversized files', async () => {
  await assertRejectsSpreadsheet({
    fileName: 'sheet.csv',
    text: 'x'.repeat(5 * 1024 * 1024 + 1),
  }, /5 MB/);
});

test('spreadsheet reader rejects too many rows, columns, and oversized cells', async () => {
  await assertRejectsSpreadsheet({
    fileName: 'sheet.csv',
    text: Array.from({ length: 1001 }, (_, index) => `row${index}`).join('\n'),
  }, /1000 rows/);

  await assertRejectsSpreadsheet({
    fileName: 'sheet.csv',
    text: Array.from({ length: 101 }, (_, index) => `col${index}`).join(','),
  }, /100 columns/);

  await assertRejectsSpreadsheet({
    fileName: 'sheet.csv',
    text: 'code\n' + 'x'.repeat(5001),
  }, /5000 characters/);
});

async function assertRejectsSpreadsheet(source, pattern) {
  await assert.rejects(
    () => readSpreadsheetRows(source),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, pattern);
      return true;
    },
  );
}
