import {
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  deleteCoaBatchItems,
  deleteCollectionItem,
  adminUpsertLabelTemplate,
  exportPeptideCollectionTransfer,
  backfillLabelDatabase,
  getCollectionNames,
  getLabelDatabaseStatus,
  importCoaBatchItems,
  importPeptideBatchItems,
  importPeptideCategoryBatchItems,
  importPeptideCollectionTransfer,
  importRoundBatchItems,
  identifyCoaPdfAsset,
  isPublicCollectionRead,
  publicReportLabelTemplate,
  publicUpsertLabelTemplate,
  publicVoteLabelTemplate,
  repairLabelDatabase,
  readCollection,
  readPublicCollection,
  readCoaPdfAsset,
  readCoaVialImageAsset,
  readLabelTemplatePreviewAsset,
  readPublicLabelTemplates,
  recoverLabelTemplate,
  permanentlyDeleteLabelTemplate,
  upsertCollectionItem,
  writeAsset,
  writeCoaPdfAsset,
  verifyLabelDatabase,
} from './helix-data.mjs';
import {
  createAdminSessionCookie,
  createCoaRoundAccessCookie,
  createLogoutCookie,
  getCoaRoundAccess,
  getCoaRoundPasscodeFingerprint,
  getAdminSession,
  getPublicSession,
  validateCoaRoundPasscode,
  validateRolePassword,
} from './helix-auth.mjs';
import { parsePeptideBatch } from './peptide-batch-parser.mjs';
import { parseRoundPeptideBatch } from './round-peptide-batch-parser.mjs';
import { parseCoaBatchRows } from './coa-batch-parser.mjs';
import { parseVendorPriceList } from './vendor-price-list-parser.mjs';

const maxBodyBytes = 24 * 1024 * 1024;
const rootDir = process.env.HELIX_ROOT_DIR
  ? path.resolve(process.env.HELIX_ROOT_DIR)
  : process.cwd();
const pepPediaIndexPath = path.join(rootDir, 'data', 'pep-pedia-index.json');
let cachedPepPediaIndex = null;
const throttleBuckets = new Map();
const loginAttemptBuckets = new Map();
const throttleWindowMs = 60 * 60 * 1000;
const maxFailedLoginAttempts = 5;
const loginAttemptWindowMs = 15 * 60 * 1000;
const loginLockoutMs = 15 * 60 * 1000;

export { maxBodyBytes };

export async function handleHelixApiRequest(request) {
  const method = request.method.toUpperCase();
  const pathname = normalizeApiPath(request.pathname);

  try {
    if (method === 'GET' && pathname.startsWith('/api/data/')) {
      const collectionName = getPathPart(pathname, 3);
      const session = getAdminSession(request.headers);

      if (!session && !isPublicCollectionRead(collectionName)) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      if (!session) {
        return jsonResponse(200, await readPublicCollection(collectionName, request.headers));
      }

      return jsonResponse(200, await readCollection(collectionName));
    }

    if (pathname === '/api/labels/report' && method === 'POST') {
      enforceThrottle(request.headers, 'label-report', 20);
      await publicReportLabelTemplate(parseJsonBody(request.bodyText), request.headers);
      return jsonResponse(200, await readPublicLabelTemplates());
    }

    if (pathname === '/api/labels/vote' && method === 'POST') {
      enforceThrottle(request.headers, 'label-vote', 60);
      await publicVoteLabelTemplate(parseJsonBody(request.bodyText), request.headers);
      return jsonResponse(200, await readPublicLabelTemplates());
    }

    if (method === 'GET' && pathname.startsWith('/api/labels/') && getPathPart(pathname, 4) === 'preview') {
      const labelId = decodeURIComponent(getPathPart(pathname, 3));
      const preview = await readLabelTemplatePreviewAsset(labelId, {
        isAdmin: Boolean(getAdminSession(request.headers)),
      });

      return binaryResponse(200, preview.buffer, {
        'Content-Type': preview.mimeType,
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': `inline; filename="${preview.fileName.replace(/["\\]/g, '')}"`,
      });
    }

    if (method === 'GET' && pathname.startsWith('/api/coas/') && getPathPart(pathname, 4) === 'pdf') {
      const coaId = decodeURIComponent(getPathPart(pathname, 3));
      const pdf = await readCoaPdfAsset(coaId, {
        headers: request.headers,
        isAdmin: Boolean(getAdminSession(request.headers)),
      });

      return binaryResponse(200, pdf.buffer, {
        'Content-Type': pdf.mimeType,
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': `inline; filename="${pdf.fileName.replace(/["\\]/g, '')}"`,
      });
    }

    if (method === 'GET' && pathname.startsWith('/api/coas/') && getPathPart(pathname, 4) === 'vial-image') {
      const coaId = decodeURIComponent(getPathPart(pathname, 3));
      const image = await readCoaVialImageAsset(coaId, {
        headers: request.headers,
        isAdmin: Boolean(getAdminSession(request.headers)),
      });

      return binaryResponse(200, image.buffer, {
        'Content-Type': image.mimeType,
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': `inline; filename="${image.fileName.replace(/["\\]/g, '')}"`,
      });
    }

    if (pathname === '/api/coas/round-passcode' && method === 'POST') {
      enforceThrottle(request.headers, 'coa-round-passcode', 30);
      const body = parseJsonBody(request.bodyText);
      const roundId = typeof body?.roundId === 'string' ? body.roundId.trim() : '';
      const rounds = await readCollection('rounds');
      const round = rounds.find((currentRound) => currentRound?.id === roundId);

      if (!round) {
        return jsonResponse(404, { error: 'Round not found' });
      }

      if (!validateCoaRoundPasscode(round, body?.passcode)) {
        return jsonResponse(401, { error: 'Invalid passcode' });
      }

      return jsonResponse(200, { ok: true, roundId: round.id }, {
        'Set-Cookie': createCoaRoundAccessCookie({
          ...getCoaRoundAccess(request.headers),
          [round.id]: getCoaRoundPasscodeFingerprint(round),
        }),
      });
    }

    if (pathname === '/api/labels') {
      if (method === 'GET') {
        return jsonResponse(
          200,
          getAdminSession(request.headers)
            ? await readCollection('label-templates')
            : await readPublicLabelTemplates(),
        );
      }

      if (method === 'POST') {
        enforceThrottle(request.headers, 'label-upload', 10);
        await publicUpsertLabelTemplate(parseJsonBody(request.bodyText));
        return jsonResponse(200, await readPublicLabelTemplates());
      }
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
      const body = parseJsonBody(request.bodyText);
      const role = body?.role === 'owner' ? 'owner' : 'admin';
      const lockoutResponse = getLoginLockoutResponse(request.headers, role);

      if (lockoutResponse) {
        return lockoutResponse;
      }

      if (!validateRolePassword(body?.password, role)) {
        recordFailedLoginAttempt(request.headers, role);
        return jsonResponse(401, { error: 'Invalid password' });
      }

      clearLoginAttempts(request.headers, role);

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

    if (pathname === '/api/admin/database/labels/status' && method === 'GET') {
      const ownerResponse = requireOwnerSession(request.headers);

      if (ownerResponse) {
        return ownerResponse;
      }

      return jsonResponse(200, await getLabelDatabaseStatus());
    }

    if (pathname === '/api/admin/database/labels/verify' && method === 'POST') {
      const ownerResponse = requireOwnerSession(request.headers);

      if (ownerResponse) {
        return ownerResponse;
      }

      return jsonResponse(200, await verifyLabelDatabase());
    }

    if (pathname === '/api/admin/database/labels/backfill' && method === 'POST') {
      const ownerResponse = requireOwnerSession(request.headers);

      if (ownerResponse) {
        return ownerResponse;
      }

      return jsonResponse(200, await backfillLabelDatabase());
    }

    if (pathname === '/api/admin/database/labels/repair' && method === 'POST') {
      const ownerResponse = requireOwnerSession(request.headers);

      if (ownerResponse) {
        return ownerResponse;
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, await repairLabelDatabase(body?.confirmation));
    }

    if (pathname === '/api/admin/assets/vendor-price-sheet' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      return jsonResponse(200, await writeAsset(parseJsonBody(request.bodyText)));
    }

    if (pathname === '/api/admin/assets/coa-pdf' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      return jsonResponse(200, await writeCoaPdfAsset(parseJsonBody(request.bodyText)));
    }

    if (pathname === '/api/admin/assets/coa-pdf-identify' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      return jsonResponse(200, await identifyCoaPdfAsset(parseJsonBody(request.bodyText)));
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

    if (pathname === '/api/admin/peptides/parse-batch' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, {
        rows: await parsePeptideBatch({
          source: body?.source,
          peptides: await readCollection('peptides'),
        }),
      });
    }

    if (pathname === '/api/admin/peptides/import-batch' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, await importPeptideBatchItems(body?.rows));
    }

    if (pathname === '/api/admin/peptide-categories/import-batch' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, await importPeptideCategoryBatchItems(body?.rows));
    }

    if (pathname === '/api/admin/rounds/parse-peptides' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, {
        rows: await parseRoundPeptideBatch({
          source: body?.source,
          peptides: await readCollection('peptides'),
          priceListItems: body?.priceListItems,
          existingRows: body?.existingRows,
        }),
      });
    }

    if (pathname === '/api/admin/rounds/import-batch' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, await importRoundBatchItems(body?.rows));
    }

    if (pathname === '/api/admin/coas/parse-batch-numbers' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, {
        rows: await parseCoaBatchRows({
          source: body?.source,
        }),
      });
    }

    if (pathname === '/api/admin/coas/import-batch' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, await importCoaBatchItems(body?.rows));
    }

    if (pathname === '/api/admin/coas/delete-batch' && method === 'POST') {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const body = parseJsonBody(request.bodyText);
      return jsonResponse(200, await deleteCoaBatchItems(body?.ids));
    }

    if (pathname.startsWith('/api/admin/data/')) {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const collectionName = getPathPart(pathname, 4);
      const itemId = decodeURIComponent(getPathPart(pathname, 5));
      const labelAction = getPathPart(pathname, 6);

      if (!collectionName || !itemId) {
        return jsonResponse(404, { error: 'Unknown admin endpoint' });
      }

      if (collectionName === 'peptides' && itemId === 'export' && method === 'GET') {
        if (session.role !== 'owner') {
          return jsonResponse(403, { error: 'Owner login required' });
        }

        return jsonResponse(200, await exportPeptideCollectionTransfer());
      }

      if (collectionName === 'peptides' && itemId === 'import' && method === 'POST') {
        if (session.role !== 'owner') {
          return jsonResponse(403, { error: 'Owner login required' });
        }

        return jsonResponse(200, await importPeptideCollectionTransfer(parseJsonBody(request.bodyText)));
      }

      if (collectionName === 'label-templates' && method === 'POST' && labelAction === 'recover') {
        return jsonResponse(200, await recoverLabelTemplate(itemId));
      }

      if (collectionName === 'label-templates' && method === 'DELETE' && labelAction === 'permanent') {
        return jsonResponse(200, await permanentlyDeleteLabelTemplate(itemId));
      }

      if (method === 'PUT') {
        if (collectionName === 'label-templates') {
          const body = parseJsonBody(request.bodyText);

          if (body?.id !== itemId) {
            return jsonResponse(400, { error: 'Item id must match the URL id.' });
          }

          return jsonResponse(200, await adminUpsertLabelTemplate(body));
        }

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
    const details = error?.details;

    logApiError(error, {
      method,
      pathname,
      statusCode,
      bodyBytes: typeof request.bodyText === 'string' ? Buffer.byteLength(request.bodyText, 'utf8') : 0,
    });

    return jsonResponse(statusCode, {
      error: message,
      ...(details !== undefined ? { details } : {}),
    });
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

export function binaryResponse(statusCode, buffer, headers = {}) {
  return {
    statusCode,
    headers,
    body: Buffer.from(buffer).toString('base64'),
    isBase64Encoded: true,
  };
}

function requireOwnerSession(headers) {
  const session = getAdminSession(headers);

  if (!session) {
    return jsonResponse(401, { error: 'Admin login required' });
  }

  if (session.role !== 'owner') {
    return jsonResponse(403, { error: 'Owner login required' });
  }

  return null;
}

function parseJsonBody(bodyText) {
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch (cause) {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    error.cause = cause;
    throw error;
  }
}

function logApiError(error, context) {
  const payload = {
    ...context,
    message: error?.message || 'Unknown error',
    details: error?.details,
    cause: error?.cause?.message,
    stack: error?.stack,
  };

  console.error('[helix-api] request failed', payload);
}

function normalizeApiPath(pathname) {
  if (pathname.startsWith('/.netlify/functions/data')) {
    const nextPathname = pathname.replace('/.netlify/functions/data', '/api/data');

    if (nextPathname === '/api/data/labels' || nextPathname.startsWith('/api/data/labels/')) {
      return nextPathname.replace('/api/data/labels', '/api/labels');
    }

    if (nextPathname.startsWith('/api/data/coas/')) {
      return nextPathname.replace('/api/data/coas', '/api/coas');
    }

    return nextPathname;
  }

  if (pathname.startsWith('/.netlify/functions/admin')) {
    return pathname.replace('/.netlify/functions/admin', '/api/admin');
  }

  return pathname;
}

function getPathPart(pathname, index) {
  return pathname.split('/')[index] ?? '';
}

function enforceThrottle(headers, action, limit) {
  const clientKey = getClientThrottleKey(headers);
  const bucketKey = `${action}:${clientKey}`;
  const now = Date.now();
  const bucket = throttleBuckets.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    throttleBuckets.set(bucketKey, { count: 1, resetAt: now + throttleWindowMs });
    return;
  }

  if (bucket.count >= limit) {
    const error = new Error('Too many requests. Try again later.');
    error.statusCode = 429;
    throw error;
  }

  bucket.count += 1;
}

function getClientThrottleKey(headers = {}) {
  const forwardedFor = getHeaderValue(headers, 'x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = forwardedFor || getHeaderValue(headers, 'cf-connecting-ip') || getHeaderValue(headers, 'x-real-ip');
  const userAgent = getHeaderValue(headers, 'user-agent') || 'unknown-agent';

  return `${clientIp || 'local'}:${userAgent.slice(0, 80)}`;
}

function getLoginLockoutResponse(headers, role) {
  const now = Date.now();
  const bucket = loginAttemptBuckets.get(getLoginAttemptKey(headers, role));

  if (!bucket) {
    return null;
  }

  if (bucket.lockedUntil > now) {
    return jsonResponse(429, { error: 'Too many login attempts. Try again later.' }, {
      'Retry-After': String(Math.ceil((bucket.lockedUntil - now) / 1000)),
    });
  }

  if (bucket.resetAt <= now) {
    loginAttemptBuckets.delete(getLoginAttemptKey(headers, role));
  }

  return null;
}

function recordFailedLoginAttempt(headers, role) {
  const key = getLoginAttemptKey(headers, role);
  const now = Date.now();
  const bucket = loginAttemptBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    loginAttemptBuckets.set(key, {
      count: 1,
      resetAt: now + loginAttemptWindowMs,
      lockedUntil: 0,
    });
    return;
  }

  bucket.count += 1;

  if (bucket.count >= maxFailedLoginAttempts) {
    bucket.lockedUntil = now + loginLockoutMs;
  }
}

function clearLoginAttempts(headers, role) {
  loginAttemptBuckets.delete(getLoginAttemptKey(headers, role));
}

function getLoginAttemptKey(headers, role) {
  return `${role}:${getClientIpKey(headers)}`;
}

function getClientIpKey(headers = {}) {
  const forwardedFor = getHeaderValue(headers, 'x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = forwardedFor || getHeaderValue(headers, 'cf-connecting-ip') || getHeaderValue(headers, 'x-real-ip');

  return clientIp || 'local';
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }

  const normalizedName = name.toLowerCase();

  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === normalizedName) {
      return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
    }
  }

  return '';
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
  const fallbackMatch = peptidepediaIndex.find((entry) =>
    matchesBlendSearchName(name, entry.name) ||
    entry.aliases.some((alias) => matchesBlendSearchName(name, alias)),
  );

  try {
    const response = await fetch('https://peptidepedia.org/all-peptides');

    if (response.ok) {
      const html = await response.text();
      const entries = extractPeptidepediaEntries(html);
      const match = entries.find((entry) =>
        matchesBlendSearchName(name, entry.name) ||
        entry.aliases.some((alias) => matchesBlendSearchName(name, alias)),
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
  const normalizedNames = createBlendSearchVariants(name);
  const entries = await getPepPediaIndex();
  const exactMatch = entries.find((entry) =>
    createBlendSearchVariants(entry.slug).some((entryName) => normalizedNames.includes(entryName)) ||
    createBlendSearchVariants(entry.slug.replace(/-/g, ' ')).some((entryName) => normalizedNames.includes(entryName)) ||
    createBlendSearchVariants(entry.slug.replace(/-plus\b/g, '+')).some((entryName) => normalizedNames.includes(entryName)),
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

function matchesBlendSearchName(query, candidate) {
  const queryNames = createBlendSearchVariants(query);
  const candidateNames = createBlendSearchVariants(candidate);

  return candidateNames.some((candidateName) => queryNames.includes(candidateName));
}

function createBlendSearchVariants(value) {
  const cleanValue = String(value ?? '').trim();
  const variants = [
    cleanValue,
    cleanValue.replace(/\b(blend|stack)\b/gi, ' '),
    `${cleanValue} blend`,
    `${cleanValue} stack`,
  ];

  return variants
    .map((variant) => normalizeSearchText(variant))
    .filter(Boolean)
    .filter((variant, index, variantList) => variantList.indexOf(variant) === index);
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
