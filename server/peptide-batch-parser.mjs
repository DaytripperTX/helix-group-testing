import { readSpreadsheetRows } from './spreadsheet-reader.mjs';

export async function parsePeptideBatch({ source, peptides }) {
  if (!source || source.type !== 'file') {
    throw createHttpError(400, 'Peptide batch file is required.');
  }

  const rows = await readSpreadsheetRows(source);
  const records = createRecordsFromRows(rows);
  const existingPeptides = Array.isArray(peptides) ? peptides : [];
  const seenNames = new Set();

  return records.map((row, index) => {
    const normalizedRow = normalizeSpreadsheetRow(row);
    const name = normalizePeptideName(normalizedRow.name);
    const existingPeptide = findByNormalizedName(existingPeptides, name);
    const normalizedRowName = normalizeName(name);
    const peptide = {
      rowNumber: index + 2,
      id: existingPeptide?.id ?? createUniqueId(name || `peptide-${index + 2}`, existingPeptides),
      name,
      kind: normalizedRow.kind,
      categories: normalizeCategories(normalizedRow.categories),
      description: sanitizeText(normalizedRow.description),
      components: normalizedRow.components,
      wikiLinks: normalizedRow.wikiLinks,
      errors: [],
    };

    if (!name) {
      peptide.errors.push('Missing name');
    }

    if (normalizedRowName) {
      if (seenNames.has(normalizedRowName)) {
        peptide.errors.push('Duplicate name in import');
      } else {
        seenNames.add(normalizedRowName);
      }
    }

    if (normalizedRow.wikiLinksError) {
      peptide.errors.push(normalizedRow.wikiLinksError);
    }

    if (normalizedRow.componentsError) {
      peptide.errors.push(normalizedRow.componentsError);
    }

    if (!normalizedRow.componentsError && normalizedRow.kind === 'blend' && normalizedRow.components.length === 0) {
      peptide.errors.push('Blend components are required');
    }

    return peptide;
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

  const componentsResult = parseSpreadsheetComponents(fields.get('components') ?? fields.get('blendcomponents') ?? '');
  const wikiLinksResult = parseSpreadsheetWikiLinks({
    wikiLinks: fields.get('wikilinks') ?? '',
    peptidepediaUrl: fields.get('peptidepediaurl') ?? fields.get('peptidepedia') ?? fields.get('url') ?? '',
    pepPediaUrl: fields.get('peppediaurl') ?? fields.get('peppedia') ?? '',
  });

  return {
    name: fields.get('name') ?? '',
    kind: normalizePeptideKind(fields.get('kind') ?? fields.get('type') ?? ''),
    categories: fields.get('categories') ?? fields.get('category') ?? '',
    description: fields.get('description') ?? '',
    components: componentsResult.components,
    componentsError: componentsResult.error,
    wikiLinks: wikiLinksResult.wikiLinks,
    wikiLinksError: wikiLinksResult.error,
  };
}

function parseSpreadsheetComponents(value) {
  if (!value.trim()) {
    return {
      components: [],
      error: '',
    };
  }

  try {
    const parsedComponents = JSON.parse(value);

    if (!Array.isArray(parsedComponents)) {
      return {
        components: [],
        error: 'Invalid components JSON',
      };
    }

    return {
      components: normalizeBlendComponents(parsedComponents),
      error: '',
    };
  } catch {
    return {
      components: [],
      error: 'Invalid components JSON',
    };
  }
}

function parseSpreadsheetWikiLinks({ wikiLinks, peptidepediaUrl, pepPediaUrl }) {
  const links = [];
  let error = '';

  if (wikiLinks.trim()) {
    try {
      const parsedLinks = JSON.parse(wikiLinks);
      links.push(...normalizeWikiLinks({ wikiLinks: parsedLinks }));
    } catch {
      error = 'Invalid wikiLinks JSON';
    }
  }

  if (peptidepediaUrl.trim()) {
    links.push(createWikiLink({
      source: 'peptidepedia',
      url: peptidepediaUrl,
      status: 'manual',
    }));
  }

  if (pepPediaUrl.trim()) {
    links.push(createWikiLink({
      source: 'pep-pedia',
      url: pepPediaUrl,
      status: 'manual',
    }));
  }

  return {
    wikiLinks: normalizeWikiLinks({ wikiLinks: links }),
    error,
  };
}

function normalizePeptideName(value) {
  const cleanValue = sanitizeText(value);
  const specialNames = new Map([
    ['bpc157', 'BPC-157'],
    ['tb500', 'TB-500'],
    ['pt141', 'PT-141'],
    ['cjc1295', 'CJC-1295'],
    ['ghkcu', 'GHK-Cu'],
    ['nad', 'NAD+'],
    ['nadplus', 'NAD+'],
    ['ss31', 'SS-31'],
    ['aod9604', 'AOD-9604'],
    ['ghrp2', 'GHRP-2'],
    ['ghrp6', 'GHRP-6'],
  ]);

  return specialNames.get(normalizeName(cleanValue)) ?? titleCase(cleanValue);
}

function normalizePeptideKind(value) {
  const normalizedKind = normalizeName(value);
  return normalizedKind === 'blend' ? 'blend' : 'peptide';
}

function normalizeBlendComponents(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const components = [];
  const seenKeys = new Set();

  for (const component of value) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
      continue;
    }

    const peptideId = sanitizeToken(component.peptideId);
    const name = sanitizeText(component.name);
    const ratio = sanitizeText(component.ratio);

    if (!name) {
      continue;
    }

    const key = peptideId || normalizeName(name);

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    components.push({ peptideId, name, ratio });
  }

  return components;
}

function normalizeCategories(value) {
  const rawCategories = Array.isArray(value) ? value : parseList(value);
  const categories = [];

  for (const category of rawCategories) {
    const normalizedCategory = normalizeCategoryName(category);

    if (
      normalizedCategory &&
      !categories.some((currentCategory) => normalizeName(currentCategory) === normalizeName(normalizedCategory))
    ) {
      categories.push(normalizedCategory);
    }
  }

  return categories;
}

function normalizeCategoryName(value) {
  const cleanValue = sanitizeText(value);
  const specialCategories = new Map([
    ['glp', 'GLP'],
    ['glp1', 'GLP'],
    ['nad', 'NAD+'],
    ['nadplus', 'NAD+'],
  ]);

  return specialCategories.get(normalizeName(cleanValue)) ?? titleCase(cleanValue);
}

function normalizeWikiLinks(peptide) {
  const rawLinks = Array.isArray(peptide.wikiLinks) ? peptide.wikiLinks : [];
  const links = rawLinks
    .map((link) => normalizeWikiLink(link))
    .filter(Boolean);

  if (links.length === 0 && peptide.peptidepediaUrl) {
    const legacyLink = createWikiLink({
      source: 'peptidepedia',
      url: peptide.peptidepediaUrl,
      status: 'verified',
    });

    if (legacyLink.url) {
      links.push(legacyLink);
    }
  }

  return sortWikiLinks(dedupeWikiLinks(links));
}

function normalizeWikiLink(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const url = sanitizeUrl(String(value.url ?? ''));

  if (!url) {
    return null;
  }

  return createWikiLink({
    source: normalizeWikiSource(value.source),
    url,
    status: normalizeWikiStatus(value.status),
  });
}

function createWikiLink(link) {
  const source = link.source ?? 'other';

  return {
    source,
    url: sanitizeUrl(link.url ?? ''),
    status: link.status ?? 'manual',
  };
}

function normalizeWikiSource(value) {
  return value === 'peptidepedia' || value === 'pep-pedia' || value === 'other' ? value : 'other';
}

function normalizeWikiStatus(value) {
  return value === 'verified' || value === 'suggested' || value === 'manual' ? value : 'manual';
}

function dedupeWikiLinks(links) {
  const seen = new Set();
  const nextLinks = [];

  for (const link of links) {
    const key = `${link.source}:${normalizeName(link.url)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextLinks.push(link);
  }

  return nextLinks;
}

function sortWikiLinks(links) {
  const order = {
    peptidepedia: 0,
    'pep-pedia': 1,
    other: 2,
  };

  return [...links].sort((first, second) => order[first.source] - order[second.source]);
}

function findByNormalizedName(items, name) {
  const normalizedName = normalizeName(name);
  return items.find((item) => normalizeName(item.name) === normalizedName);
}

function createUniqueId(name, items) {
  const baseId = slugify(name) || `item-${Date.now()}`;
  const usedIds = new Set(items.map((item) => item.id));
  let nextId = baseId;
  let suffix = 2;

  while (usedIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

function sanitizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sanitizeUrl(value) {
  const cleanValue = sanitizeText(value);

  if (!cleanValue) {
    return '';
  }

  try {
    const parsedUrl = new URL(cleanValue);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
}

function sanitizeToken(value) {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 120);
}

function titleCase(value) {
  return sanitizeText(value)
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word === word.toUpperCase() && word.length <= 5) {
        return word;
      }

      return word
        .split('-')
        .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
        .join('-');
    })
    .join(' ');
}

function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseList(value) {
  return String(value ?? '')
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
