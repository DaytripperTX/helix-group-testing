import {
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteCollectionItem,
  getCollectionNames,
  publicUpsertLabelTemplate,
  readCollection,
  upsertCollectionItem,
  writeAsset,
} from './helix-data.mjs';
import {
  createAdminSessionCookie,
  createLogoutCookie,
  getAdminSession,
  getPublicSession,
  validateRolePassword,
} from './helix-auth.mjs';
import { parseVendorPriceList } from './vendor-price-list-parser.mjs';

const maxBodyBytes = 24 * 1024 * 1024;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pepPediaIndexPath = path.join(rootDir, 'data', 'pep-pedia-index.json');
let cachedPepPediaIndex = null;

export { maxBodyBytes };

export async function handleHelixApiRequest(request) {
  const method = request.method.toUpperCase();
  const pathname = normalizeApiPath(request.pathname);

  try {
    if (method === 'GET' && pathname.startsWith('/api/data/')) {
      const collectionName = getPathPart(pathname, 3);

      if (collectionName === 'admin-notes' && !getAdminSession(request.headers)) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      return jsonResponse(200, await readCollection(collectionName));
    }

    if (pathname === '/api/labels') {
      if (method === 'GET') {
        return jsonResponse(200, await readCollection('label-templates'));
      }

      if (method === 'POST') {
        return jsonResponse(200, await publicUpsertLabelTemplate(parseJsonBody(request.bodyText)));
      }
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
      const body = parseJsonBody(request.bodyText);
      const role = body?.role === 'owner' ? 'owner' : 'admin';

      if (!validateRolePassword(body?.password, role)) {
        return jsonResponse(401, { error: 'Invalid password' });
      }

      return jsonResponse(200, getPublicSession({ role }), {
        'Set-Cookie': createAdminSessionCookie(role),
      });
    }

    if (pathname === '/api/admin/session' && method === 'GET') {
      return jsonResponse(200, getPublicSession(getAdminSession(request.headers)));
    }

    if (pathname === '/api/admin/logout' && method === 'POST') {
      return jsonResponse(200, { ok: true }, { 'Set-Cookie': createLogoutCookie() });
    }

    if (pathname === '/api/admin/assets/vendor-price-sheet' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      return jsonResponse(200, await writeAsset(parseJsonBody(request.bodyText)));
    }

    if ((pathname === '/api/admin/wiki/search' || pathname === '/api/admin/peptidepedia/search') && method === 'GET') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const url = new URL(request.url ?? request.pathname, 'http://localhost');
      return jsonResponse(200, await searchWiki(url.searchParams.get('name') ?? ''));
    }

    if (pathname === '/api/admin/vendor-price-lists/parse' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(
        200,
        await parseVendorPriceList({
          vendorId: body?.vendorId,
          vendorName: body?.vendorName,
          source: body?.source,
          peptides: await readCollection('peptides'),
        }),
      );
    }

    if (pathname.startsWith('/api/admin/data/')) {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const collectionName = getPathPart(pathname, 4);
      const itemId = decodeURIComponent(getPathPart(pathname, 5));

      if (!collectionName || !itemId) {
        return jsonResponse(404, { error: 'Unknown admin endpoint' });
      }

      if (method === 'PUT') {
        return jsonResponse(
          200,
          await upsertCollectionItem(collectionName, itemId, parseJsonBody(request.bodyText)),
        );
      }

      if (method === 'DELETE') {
        return jsonResponse(200, await deleteCollectionItem(collectionName, itemId));
      }
    }

    if (method === 'GET' && pathname === '/api/data') {
      return jsonResponse(200, { collections: getCollectionNames() });
    }

    return jsonResponse(404, { error: 'Unknown endpoint' });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    const message = statusCode === 500 ? 'Server error' : error.message;

    if (statusCode === 500) {
      console.error(error);
    }

    return jsonResponse(statusCode, { error: message });
  }
}

export function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(bodyText) {
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function normalizeApiPath(pathname) {
  if (pathname.startsWith('/.netlify/functions/data')) {
    const nextPathname = pathname.replace('/.netlify/functions/data', '/api/data');
    return nextPathname === '/api/data/labels' ? '/api/labels' : nextPathname;
  }

  if (pathname.startsWith('/.netlify/functions/admin')) {
    return pathname.replace('/.netlify/functions/admin', '/api/admin');
  }

  return pathname;
}

function getPathPart(pathname, index) {
  return pathname.split('/')[index] ?? '';
}

async function searchWiki(name) {
  const normalizedName = normalizeSearchText(name);

  if (!normalizedName) {
    return { match: null };
  }

  const peptidepediaMatch = await searchPeptidepedia(name);
  const pepPediaMatch = await searchPepPedia(name);
  const wikiLinks = [];

  if (peptidepediaMatch) {
    wikiLinks.push(createWikiLink({
      source: 'peptidepedia',
      url: peptidepediaMatch.url,
      status: 'verified',
    }));
  }

  if (pepPediaMatch) {
    wikiLinks.push(createWikiLink({
      source: 'pep-pedia',
      url: pepPediaMatch.url,
      status: 'verified',
    }));
  }

  if (wikiLinks.length === 0) {
    return { match: null };
  }

  return {
    match: {
      name: peptidepediaMatch?.name ?? name.trim(),
      categories: peptidepediaMatch?.categories ?? [],
      wikiLinks,
    },
  };
}

async function searchPeptidepedia(name) {
  const normalizedName = normalizeSearchText(name);

  const fallbackMatch = peptidepediaIndex.find((entry) =>
    normalizeSearchText(entry.name) === normalizedName ||
    entry.aliases.some((alias) => normalizeSearchText(alias) === normalizedName),
  );

  try {
    const response = await fetch('https://peptidepedia.org/all-peptides');

    if (response.ok) {
      const html = await response.text();
      const entries = extractPeptidepediaEntries(html);
      const match = entries.find((entry) =>
        normalizeSearchText(entry.name) === normalizedName ||
        entry.aliases.some((alias) => normalizeSearchText(alias) === normalizedName),
      );

      if (match) {
        return match;
      }
    }
  } catch {
    // Fall back to the bundled index when Peptidepedia is unreachable.
  }

  return fallbackMatch ?? null;
}

async function searchPepPedia(name) {
  const normalizedName = normalizeSearchText(name);
  const entries = await getPepPediaIndex();
  const exactMatch = entries.find((entry) =>
    normalizeSearchText(entry.slug) === normalizedName ||
    normalizeSearchText(entry.slug.replace(/-/g, ' ')) === normalizedName ||
    normalizeSearchText(entry.slug.replace(/-plus\b/g, '+')) === normalizedName,
  );

  if (exactMatch) {
    return { url: exactMatch.url };
  }

  return null;
}

function extractPeptidepediaEntries(html) {
  const entries = [];
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html))) {
    const href = match[1];
    const text = stripHtml(match[2]).replace(/\s+/g, ' ').trim();
    const knownEntry = peptidepediaIndex.find((entry) => href.includes(new URL(entry.url).pathname));

    if (knownEntry) {
      entries.push(knownEntry);
      continue;
    }

    const title = text.split(/\s+(recovery|weight-loss|aesthetics|performance|longevity|cognitive)\b/i)[0]?.trim();

    if (title && href.startsWith('/')) {
      entries.push({
        name: title,
        aliases: [],
        url: `https://peptidepedia.org${href}`,
        categories: getPeptidepediaCategories(`https://peptidepedia.org${href}`),
      });
    }
  }

  return entries;
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, '');
}

function normalizeSearchText(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function createWikiLink({ source, url, status }) {
  return { source, url, status };
}

async function getPepPediaIndex() {
  if (cachedPepPediaIndex) {
    return cachedPepPediaIndex;
  }

  try {
    const document = JSON.parse(await readFile(pepPediaIndexPath, 'utf8'));
    cachedPepPediaIndex = Array.isArray(document.items) ? document.items : [];
  } catch {
    cachedPepPediaIndex = [];
  }

  return cachedPepPediaIndex;
}

const peptidepediaIndex = [
  {
    name: 'BPC-157',
    aliases: ['BPC 157'],
    url: 'https://peptidepedia.org/recovery/bpc-157',
    categories: ['Recovery'],
  },
  {
    name: 'Semaglutide',
    aliases: [],
    url: 'https://peptidepedia.org/weight-loss/semaglutide',
    categories: ['GLP', 'Metabolic'],
  },
  {
    name: 'Tirzepatide',
    aliases: [],
    url: 'https://peptidepedia.org/weight-loss/tirzepatide',
    categories: ['GLP', 'Metabolic'],
  },
  {
    name: 'TB-500',
    aliases: ['TB 500'],
    url: 'https://peptidepedia.org/recovery/tb-500',
    categories: ['Recovery'],
  },
  {
    name: 'Retatrutide',
    aliases: [],
    url: 'https://peptidepedia.org/weight-loss/retatrutide',
    categories: ['GLP', 'Metabolic'],
  },
  {
    name: 'GHK-Cu',
    aliases: ['GHK Cu'],
    url: 'https://peptidepedia.org/aesthetics/ghk-cu',
    categories: ['Skin'],
  },
  {
    name: 'KPV',
    aliases: [],
    url: 'https://peptidepedia.org/longevity/kpv',
    categories: ['Longevity', 'Immune', 'Skin'],
  },
  {
    name: 'Ipamorelin',
    aliases: [],
    url: 'https://peptidepedia.org/performance/ipamorelin',
    categories: ['Performance', 'Hormone'],
  },
  {
    name: 'CJC-1295',
    aliases: ['CJC 1295'],
    url: 'https://peptidepedia.org/performance/cjc-1295',
    categories: ['Performance', 'Hormone'],
  },
  {
    name: 'Sermorelin',
    aliases: [],
    url: 'https://peptidepedia.org/performance/sermorelin',
    categories: ['Performance', 'Hormone'],
  },
  {
    name: 'PT-141',
    aliases: ['PT 141', 'Bremelanotide'],
    url: 'https://peptidepedia.org/performance/pt-141',
    categories: ['Performance', 'Hormone'],
  },
  {
    name: 'Melanotan II',
    aliases: ['Melanotan 2'],
    url: 'https://peptidepedia.org/aesthetics/melanotan-ii',
    categories: ['Skin', 'Aesthetics'],
  },
  {
    name: 'AOD-9604',
    aliases: ['AOD 9604'],
    url: 'https://peptidepedia.org/weight-loss/aod-9604',
    categories: ['Metabolic'],
  },
  {
    name: 'Tesamorelin',
    aliases: [],
    url: 'https://peptidepedia.org/performance/tesamorelin',
    categories: ['Performance', 'Hormone', 'Metabolic'],
  },
  {
    name: 'Liraglutide',
    aliases: [],
    url: 'https://peptidepedia.org/weight-loss/liraglutide',
    categories: ['GLP', 'Metabolic'],
  },
  {
    name: 'Epithalon',
    aliases: ['Epitalon'],
    url: 'https://peptidepedia.org/longevity/epithalon',
    categories: ['Longevity', 'Bioregulators'],
  },
  {
    name: 'Thymosin Alpha 1',
    aliases: ['Thymosin Alpha-1', 'TA1'],
    url: 'https://peptidepedia.org/longevity/thymosin-alpha-1',
    categories: ['Longevity', 'Immune'],
  },
  {
    name: 'Selank',
    aliases: [],
    url: 'https://peptidepedia.org/cognitive/selank',
    categories: ['Cognitive'],
  },
  {
    name: 'Semax',
    aliases: [],
    url: 'https://peptidepedia.org/cognitive/semax',
    categories: ['Cognitive'],
  },
  {
    name: 'GHRP-2',
    aliases: ['GHRP 2'],
    url: 'https://peptidepedia.org/performance/ghrp-2',
    categories: ['Performance', 'Hormone'],
  },
  {
    name: 'GHRP-6',
    aliases: ['GHRP 6'],
    url: 'https://peptidepedia.org/performance/ghrp-6',
    categories: ['Performance', 'Hormone'],
  },
  {
    name: 'SS-31',
    aliases: ['SS 31', 'Elamipretide'],
    url: 'https://peptidepedia.org/longevity/ss-31',
    categories: ['Longevity', 'Mitochondrial'],
  },
  {
    name: 'Survodutide',
    aliases: ['BI 456906'],
    url: 'https://peptidepedia.org/weight-loss/survodutide',
    categories: ['GLP', 'Metabolic'],
  },
];

function getPeptidepediaCategories(url) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
    const category = {
      aesthetics: ['Aesthetics'],
      cognitive: ['Cognitive'],
      longevity: ['Longevity'],
      performance: ['Performance'],
      recovery: ['Recovery'],
      'weight-loss': ['GLP', 'Metabolic'],
    }[segment];

    return category ?? [];
  } catch {
    return [];
  }
}
