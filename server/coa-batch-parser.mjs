import { readSpreadsheetRows } from './spreadsheet-reader.mjs';

const maxBatchRows = 250;

export async function parseCoaBatchRows({ source } = {}) {
  const rows = await readSpreadsheetRows(source);
  const headerInfo = getHeaderInfo(rows);
  const dataRows = rows.slice(headerInfo.startIndex);

  return dataRows
    .slice(0, maxBatchRows)
    .map((row) => parseRow(row, headerInfo.headerMap))
    .filter((row) => row.peptideName || row.code || row.batchNumber || row.capColor);
}

function getHeaderInfo(rows) {
  const headerIndex = rows.findIndex((row) => {
    const normalizedCells = row.map(normalizeHeader);
    return normalizedCells.some((cell) => batchHeaders.has(cell))
      && (normalizedCells.some((cell) => codeHeaders.has(cell)) || normalizedCells.some((cell) => peptideHeaders.has(cell)));
  });

  if (headerIndex === -1) {
    return {
      startIndex: 0,
      headerMap: {
        peptideName: 0,
        batchNumber: 1,
        code: 2,
        capColor: 3,
      },
    };
  }

  return {
    startIndex: headerIndex + 1,
    headerMap: createHeaderMap(rows[headerIndex]),
  };
}

function createHeaderMap(headerRow) {
  return headerRow.reduce((map, cell, index) => {
    const header = normalizeHeader(cell);

    if (peptideHeaders.has(header) && map.peptideName === undefined) {
      map.peptideName = index;
    } else if (batchHeaders.has(header) && map.batchNumber === undefined) {
      map.batchNumber = index;
    } else if (codeHeaders.has(header) && map.code === undefined) {
      map.code = index;
    } else if (capColorHeaders.has(header) && map.capColor === undefined) {
      map.capColor = index;
    }

    return map;
  }, {});
}

function parseRow(row, headerMap) {
  return {
    peptideName: getCell(row, headerMap.peptideName),
    batchNumber: getCell(row, headerMap.batchNumber),
    code: getCell(row, headerMap.code),
    capColor: getCell(row, headerMap.capColor),
  };
}

function getCell(row, index) {
  return index === undefined ? '' : sanitizeText(row[index]);
}

function sanitizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const peptideHeaders = new Set(['peptide', 'peptidename', 'product', 'productname', 'name']);
const batchHeaders = new Set(['batch', 'batchnumber', 'batchno', 'batchnum', 'batchid', 'batchcode']);
const codeHeaders = new Set(['code', 'vendorcode', 'itemcode', 'sku', 'productcode']);
const capColorHeaders = new Set(['capcolor', 'capcolour', 'color', 'colour', 'cap']);
