import { parseString } from '@fast-csv/parse';
import { readSheet } from 'read-excel-file/node';

const maxSpreadsheetBytes = 5 * 1024 * 1024;
const maxSpreadsheetRows = 1000;
const maxSpreadsheetColumns = 100;
const maxSpreadsheetCellLength = 5000;
const allowedExtensions = new Set(['csv', 'xlsx']);

export async function readSpreadsheetRows(source = {}) {
  const fileName = String(source.fileName ?? '');
  const extension = getAllowedExtension(fileName);
  const content = getSourceContent(source);

  if (content.byteLength > maxSpreadsheetBytes) {
    throw createHttpError(400, 'Spreadsheet file must be 5 MB or smaller.');
  }

  const rows = extension === 'csv'
    ? await readCsvRows(content.toString('utf8'))
    : await readXlsxRows(content);

  return validateSpreadsheetRows(rows);
}

function getAllowedExtension(fileName) {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (!allowedExtensions.has(extension)) {
    throw createHttpError(400, 'Spreadsheet file must be a CSV or XLSX file.');
  }

  return extension;
}

function getSourceContent(source) {
  if (Buffer.isBuffer(source.buffer)) {
    return source.buffer;
  }

  if (typeof source.text === 'string') {
    return Buffer.from(source.text, 'utf8');
  }

  if (typeof source.base64 === 'string') {
    return Buffer.from(source.base64, 'base64');
  }

  throw createHttpError(400, 'Spreadsheet file data is required.');
}

function readCsvRows(content) {
  return new Promise((resolve, reject) => {
    const rows = [];

    parseString(content, {
      headers: false,
      ignoreEmpty: false,
      trim: false,
    })
      .on('error', (error) => reject(createHttpError(400, error.message || 'CSV file could not be parsed.')))
      .on('data', (row) => rows.push(Array.isArray(row) ? row : Object.values(row)))
      .on('end', () => resolve(rows));
  });
}

async function readXlsxRows(content) {
  try {
    return await readSheet(content);
  } catch {
    throw createHttpError(400, 'XLSX file could not be parsed.');
  }
}

function validateSpreadsheetRows(rows) {
  if (!Array.isArray(rows)) {
    throw createHttpError(400, 'Spreadsheet file could not be parsed.');
  }

  if (rows.length > maxSpreadsheetRows) {
    throw createHttpError(400, `Spreadsheet file must have ${maxSpreadsheetRows} rows or fewer.`);
  }

  return rows.map((row) => {
    const cells = Array.isArray(row) ? row : [];

    if (cells.length > maxSpreadsheetColumns) {
      throw createHttpError(400, `Spreadsheet rows must have ${maxSpreadsheetColumns} columns or fewer.`);
    }

    return cells.map((cell) => {
      const value = cell == null ? '' : String(cell);

      if (value.length > maxSpreadsheetCellLength) {
        throw createHttpError(400, `Spreadsheet cells must be ${maxSpreadsheetCellLength} characters or fewer.`);
      }

      return value;
    });
  });
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
