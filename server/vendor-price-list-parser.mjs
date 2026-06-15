import { readSpreadsheetRows } from './spreadsheet-reader.mjs';

const defaultVialsPerPack = 10;

const headerAliases = {
  vendorCode: ['code', 'vendor code', 'sku'],
  productName: ['product', 'name', 'description'],
  mass: ['mass', 'strength / vial', 'strength', 'strength per vial'],
  price: ['price', 'price (usd / pack)', 'usd'],
  vialsPerPack: ['vials / pack', 'vials per pack', 'kit', 'pack'],
};

export async function parseVendorPriceList({ vendorId, vendorName, source, peptides }) {
  if (!vendorId || typeof vendorId !== 'string') {
    throw createHttpError(400, 'Vendor id is required.');
  }

  const rows = await readSourceRows(source);
  const parsedRows = parseRows(vendorId, rows, Array.isArray(peptides) ? peptides : []);

  return {
    id: vendorId,
    vendorId,
    vendorName: typeof vendorName === 'string' ? vendorName : '',
    source: normalizeSource(source),
    items: parsedRows,
    parsedAt: new Date().toISOString(),
  };
}

async function readSourceRows(source) {
  if (!source || typeof source !== 'object') {
    throw createHttpError(400, 'Price list source is required.');
  }

  if (source.type === 'file') {
    if (typeof source.base64 !== 'string') {
      throw createHttpError(400, 'Uploaded file data is required.');
    }

    return readSpreadsheetRows(source);
  }

  if (source.type === 'google-sheet') {
    if (typeof source.url !== 'string' || !source.url.trim()) {
      throw createHttpError(400, 'Google Sheet URL is required.');
    }

    const response = await fetch(getGoogleSheetCsvUrl(source.url.trim()));

    if (!response.ok) {
      throw createHttpError(400, 'Google Sheet could not be fetched.');
    }

    return readSpreadsheetRows({
      fileName: 'price-list.csv',
      text: await response.text(),
    });
  }

  throw createHttpError(400, 'Unsupported price list source.');
}

function parseRows(vendorId, rows, peptides) {
  const headerIndex = rows.findIndex((row) => Object.keys(getHeaderMap(row)).length >= 2);

  if (headerIndex < 0) {
    throw createHttpError(400, 'Price list headers could not be found.');
  }

  const headerMap = getHeaderMap(rows[headerIndex]);
  const dataRows = rows.slice(headerIndex + 1);

  return dataRows
    .map((row) => parseRow(vendorId, row, headerMap, peptides))
    .filter((item) => item !== null);
}

function parseRow(vendorId, row, headerMap, peptides) {
  if (!Array.isArray(row) || row.every((cell) => String(cell ?? '').trim() === '')) {
    return null;
  }

  const vendorCode = getCell(row, headerMap.vendorCode);
  const productName = getCell(row, headerMap.productName);
  const mass = getCell(row, headerMap.mass);
  const priceText = getCell(row, headerMap.price);
  const vialsText = getCell(row, headerMap.vialsPerPack);

  if (!vendorCode && !productName && !mass && !priceText) {
    return null;
  }

  const price = parseNumber(priceText);
  const vialsPerPack = parseNumber(vialsText) ?? defaultVialsPerPack;

  return {
    id: createItemId(vendorId, vendorCode, productName, mass),
    vendorCode,
    productName,
    mass,
    price,
    vialsPerPack,
    peptideIds: matchPeptides(productName, peptides),
    needsReview: price === null,
  };
}

function getHeaderMap(row) {
  const normalizedHeaders = Array.isArray(row) ? row.map((cell) => normalizeHeader(String(cell ?? ''))) : [];
  const headerMap = {};

  for (const [field, aliases] of Object.entries(headerAliases)) {
    const index = normalizedHeaders.findIndex((header) =>
      aliases.some((alias) => header === normalizeHeader(alias)),
    );

    if (index >= 0) {
      headerMap[field] = index;
    }
  }

  return Object.keys(headerMap).length >= 2 ? headerMap : {};
}

function getCell(row, index) {
  if (typeof index !== 'number') {
    return '';
  }

  return String(row[index] ?? '').trim();
}

function parseNumber(value) {
  const normalizedValue = String(value ?? '').replace(/[$,\s]/g, '');

  if (!normalizedValue) {
    return null;
  }

  const parsed = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchPeptides(productName, peptides) {
  const productNames = getNameMatchVariants(productName);

  if (productNames.length === 0) {
    return [];
  }

  const exactMatch = peptides.find((peptide) =>
    getNameMatchVariants(peptide.name).some((peptideName) => productNames.includes(peptideName)),
  );

  if (exactMatch?.id) {
    return [exactMatch.id];
  }

  return peptides
    .filter((peptide) => {
      const peptideNames = getNameMatchVariants(peptide.name);
      return peptideNames.some((peptideName) => productNames.includes(peptideName));
    })
    .map((peptide) => peptide.id)
    .filter(Boolean);
}

function getNameMatchVariants(value) {
  return [
    value,
    String(value ?? '').replace(/\([^)]*\)/g, ' '),
  ]
    .map((variant) => normalizeName(variant))
    .filter(Boolean)
    .filter((variant, index, variants) => variants.indexOf(variant) === index);
}

function normalizeSource(source) {
  if (source?.type === 'google-sheet') {
    return {
      type: 'google-sheet',
      url: String(source.url ?? ''),
    };
  }

  return {
    type: 'file',
    fileName: String(source?.fileName ?? 'price-list'),
    mimeType: String(source?.mimeType ?? 'application/octet-stream'),
  };
}

function getGoogleSheetCsvUrl(url) {
  const sheetId = getRawGoogleSheetId(url);

  if (sheetId) {
    return createGoogleSheetCsvUrl(sheetId, '0');
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw createHttpError(400, 'Google Sheet URL must be a docs.google.com URL or Sheet id.');
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'docs.google.com') {
    throw createHttpError(400, 'Google Sheet URL must use https://docs.google.com.');
  }

  const urlSheetId = getGoogleSheetIdFromUrl(parsedUrl);

  if (!urlSheetId) {
    throw createHttpError(400, 'Google Sheet URL must include a recognizable Sheet id.');
  }

  return createGoogleSheetCsvUrl(urlSheetId, getGoogleSheetGid(parsedUrl));
}

function getRawGoogleSheetId(value) {
  const trimmedValue = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmedValue) ? trimmedValue : '';
}

function getGoogleSheetIdFromUrl(parsedUrl) {
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  const idMarkerIndex = pathParts.findIndex((part) => part === 'd');
  const pathSheetId = idMarkerIndex >= 0 ? getRawGoogleSheetId(pathParts[idMarkerIndex + 1]) : '';

  return pathSheetId || getRawGoogleSheetId(parsedUrl.searchParams.get('id'));
}

function getGoogleSheetGid(parsedUrl) {
  const queryGid = parsedUrl.searchParams.get('gid');

  if (queryGid) {
    return queryGid;
  }

  const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
  return hashParams.get('gid') ?? '0';
}

function createGoogleSheetCsvUrl(sheetId, gid) {
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export`);
  exportUrl.searchParams.set('format', 'csv');
  exportUrl.searchParams.set('gid', gid);
  return exportUrl.toString();
}

function createItemId(vendorId, vendorCode, productName, mass) {
  return [vendorId, vendorCode, productName, mass]
    .map((part) => slugify(String(part ?? '')))
    .filter(Boolean)
    .join('-')
    .slice(0, 120);
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeHeader(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
