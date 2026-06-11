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

    const buffer = Buffer.from(source.base64, 'base64');
    return readWorkbookRows(buffer, source.fileName);
  }

  if (source.type === 'google-sheet') {
    if (typeof source.url !== 'string' || !source.url.trim()) {
      throw createHttpError(400, 'Google Sheet URL is required.');
    }

    const response = await fetch(getGoogleSheetCsvUrl(source.url.trim()));

    if (!response.ok) {
      throw createHttpError(400, 'Google Sheet could not be fetched.');
    }

    return readWorkbookRows(await response.text(), 'price-list.csv');
  }

  throw createHttpError(400, 'Unsupported price list source.');
}

async function readWorkbookRows(content, fileName = '') {
  const module = await import('xlsx');
  const XLSX = module.default ?? module;
  const extension = fileName.split('.').pop()?.toLowerCase();
  const workbook =
    extension === 'csv' || typeof content === 'string'
      ? XLSX.read(typeof content === 'string' ? content : content.toString('utf8'), { type: 'string' })
      : XLSX.read(content, { type: 'buffer' });
  const firstSheetName =
    workbook.SheetNames.find((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: '',
      });

      return rows.some((row) => Object.keys(getHeaderMap(row)).length >= 2);
    }) ?? workbook.SheetNames[0];

  if (!firstSheetName) {
    throw createHttpError(400, 'Price list file does not contain a worksheet.');
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: '',
  });
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
  const normalizedProduct = normalizeName(productName);

  if (!normalizedProduct) {
    return [];
  }

  const exactMatch = peptides.find((peptide) => normalizeName(peptide.name) === normalizedProduct);

  if (exactMatch?.id) {
    return [exactMatch.id];
  }

  return peptides
    .filter((peptide) => {
      const normalizedPeptide = normalizeName(peptide.name);
      return normalizedPeptide.length > 0 && normalizedProduct.includes(normalizedPeptide);
    })
    .map((peptide) => peptide.id)
    .filter(Boolean);
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
  const parsedUrl = new URL(url);
  const match = parsedUrl.pathname.match(/\/spreadsheets\/d\/([^/]+)/);

  if (!match) {
    return url;
  }

  const gid = parsedUrl.searchParams.get('gid') ?? '0';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
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
