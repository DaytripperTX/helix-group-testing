import { readSpreadsheetRows } from './spreadsheet-reader.mjs';

const allowedTiers = new Set(['none', 'platinum', 'gold', 'gold-plus', 'bronze']);

export async function parseRoundPeptideBatch({ source, peptides = [], priceListItems = [], existingRows = [] }) {
  if (!source || source.type !== 'file') {
    throw createHttpError(400, 'Round peptide batch file is required.');
  }

  const rows = await readSpreadsheetRows(source);
  const records = createRecordsFromRows(rows);
  const knownPeptides = Array.isArray(peptides) ? peptides : [];
  const knownPriceItems = Array.isArray(priceListItems) ? priceListItems : [];
  const usedIds = Array.isArray(existingRows) ? existingRows.map((row) => ({ id: row?.id })).filter((row) => row.id) : [];

  return records.map((record, index) => {
    const row = normalizeSpreadsheetRow(record);
    const priceItem = findPriceListItem(row, knownPriceItems);
    const peptide = findPeptide(row.peptideName || priceItem?.productName || '', knownPeptides, priceItem);
    const peptideName = peptide?.name || sanitizeText(row.peptideName || priceItem?.productName);
    const sheetMass = normalizeImportedMass(row.mass, peptideName || priceItem?.productName);
    const tier = normalizeTestingTier(row.testingTier);
    const parsedRow = {
      rowNumber: index + 2,
      id: createUniqueId(peptideName || row.vendorCode || `round-row-${index + 2}`, usedIds),
      peptideId: peptide?.id ?? '',
      peptideName,
      priceListItemId: priceItem?.id ?? '',
      vendorCode: sanitizeText(row.vendorCode || priceItem?.vendorCode),
      vendorPrice: parseNullableNumber(row.vendorPrice || priceItem?.price),
      vendorPriceOverridden: Boolean(row.vendorPrice),
      mass: sheetMass || sanitizeText(priceItem?.mass),
      testingTier: tier || 'none',
      additionalTesting: sanitizeText(row.additionalTesting),
      batchConformity: parseBoolean(row.batchConformity),
      capColor: sanitizeText(row.capColor),
      notes: sanitizeText(row.notes),
      participantCount: parseNonNegativeInteger(row.participantCount),
      totalOrdered: parseNonNegativeInteger(row.totalOrdered),
      errors: [],
    };

    usedIds.push({ id: parsedRow.id });

    if (!parsedRow.peptideName) {
      parsedRow.errors.push('Missing peptide name');
    }

    if (!tier && row.testingTier) {
      parsedRow.errors.push('Invalid testing tier');
    }

    return parsedRow;
  });
}

function createRecordsFromRows(rows) {
  const [headerRow, ...dataRows] = rows;
  const headers = Array.isArray(headerRow) ? headerRow.map((cell) => String(cell ?? '')) : [];

  if (headers.every((header) => !header.trim())) {
    throw createHttpError(400, 'Spreadsheet headers could not be found.');
  }

  return dataRows
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function normalizeSpreadsheetRow(row) {
  const fields = new Map(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[^a-z0-9]/g, ''), String(value ?? '').trim()]),
  );

  return {
    peptideName: fields.get('peptidename') ?? fields.get('peptide') ?? fields.get('name') ?? '',
    vendorCode: fields.get('vendorcode') ?? fields.get('vendorid') ?? fields.get('suppliercode') ?? fields.get('code') ?? '',
    vendorPrice: fields.get('vendorprice') ?? fields.get('price') ?? '',
    mass: fields.get('mass') ?? fields.get('mg') ?? '',
    testingTier: fields.get('testingtier') ?? fields.get('tier') ?? '',
    additionalTesting: fields.get('additionaltesting') ?? fields.get('additional') ?? '',
    batchConformity: fields.get('batchconformity') ?? fields.get('batch') ?? fields.get('conformity') ?? '',
    capColor: fields.get('capcolor') ?? fields.get('cap') ?? '',
    notes: fields.get('notes') ?? fields.get('note') ?? '',
    participantCount: fields.get('participantcount') ?? fields.get('headcount') ?? fields.get('participants') ?? fields.get('heads') ?? '',
    totalOrdered: fields.get('totalordered') ?? fields.get('totalorderqty') ?? fields.get('totalqty') ?? fields.get('total') ?? fields.get('ordered') ?? '',
  };
}

function findPriceListItem(row, priceListItems) {
  const normalizedCode = normalizeName(row.vendorCode);
  const normalizedName = normalizeName(row.peptideName);

  if (normalizedCode) {
    const codeMatch = priceListItems.find((item) => normalizeName(item?.vendorCode ?? '') === normalizedCode);

    if (codeMatch) {
      return codeMatch;
    }
  }

  if (normalizedName) {
    return priceListItems.find((item) => normalizeName(item?.productName ?? '') === normalizedName) ?? null;
  }

  return null;
}

function findPeptide(name, peptides, priceItem) {
  const pricePeptideId = Array.isArray(priceItem?.peptideIds) ? priceItem.peptideIds[0] : '';

  if (pricePeptideId) {
    const linkedPeptide = peptides.find((peptide) => peptide?.id === pricePeptideId);

    if (linkedPeptide) {
      return linkedPeptide;
    }
  }

  const sourceNames = getNameMatchVariants(name);

  if (sourceNames.length === 0) {
    return null;
  }

  return peptides.find((peptide) =>
    getNameMatchVariants(peptide?.name).some((peptideName) => sourceNames.includes(peptideName)),
  ) ?? null;
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

function normalizeTestingTier(value) {
  const normalizedTier = sanitizeText(value).toLowerCase().replace(/\s+/g, '-');

  if (normalizedTier === 'goldplus' || normalizedTier === 'gold+') {
    return 'gold-plus';
  }

  return allowedTiers.has(normalizedTier) ? normalizedTier : '';
}

function parseBoolean(value) {
  const normalizedValue = sanitizeText(value).toLowerCase();

  return ['1', 'true', 'yes', 'y', 'x', 'checked'].includes(normalizedValue);
}

function parseNullableNumber(value) {
  const cleanValue = String(value ?? '').trim().replace(/[$,\s]/g, '');

  if (!cleanValue) {
    return null;
  }

  const parsed = Number.parseFloat(cleanValue);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function normalizeImportedMass(value, peptideName) {
  const cleanValue = sanitizeText(value);

  if (!cleanValue || isBacWaterName(peptideName)) {
    return cleanValue;
  }

  const numericValue = cleanValue.replace(/,/g, '').match(/\d+(?:\.\d+)?/);

  return numericValue ? numericValue[0] : cleanValue;
}

function isBacWaterName(value) {
  return normalizeName(value).includes('bacwater') || normalizeName(value).includes('bacteriostaticwater');
}

function parseNonNegativeInteger(value) {
  const parsed = Number(String(value ?? '').trim().replace(/[,\s]/g, ''));

  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function sanitizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function createUniqueId(name, items) {
  const baseId = slugify(name) || `round-row-${Date.now()}`;
  const usedIds = new Set(items.map((item) => item.id));
  let nextId = baseId;
  let suffix = 2;

  while (usedIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

function slugify(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(value) {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
