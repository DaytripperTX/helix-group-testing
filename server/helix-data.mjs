import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const seedDir = path.join(rootDir, 'data');
const localDataDir = process.env.HELIX_LOCAL_DATA_DIR
  ? path.resolve(process.env.HELIX_LOCAL_DATA_DIR)
  : path.join(rootDir, '.local-data');
const legacyLabelsPath = path.join(rootDir, 'dist', 'stored-data', 'labels', 'templates.json');
const storeName = 'helix-data';
const maxLabelPreviewBytes = 3 * 1024 * 1024;
const maxLabelCodeLength = 20 * 1024;
const maxReportCountBeforeHide = 3;
const allowedPreviewMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const allowedReportReasons = new Set(['offensive', 'spam', 'unsafe', 'other']);
const blockedTextFragments = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'dick',
  'pussy',
  'asshole',
  'bastard',
  'slut',
  'whore',
];

const collections = new Map([
  ['peptides', { fileName: 'peptides.json', kind: 'items' }],
  ['peptide-categories', { fileName: 'peptide-categories.json', kind: 'items' }],
  ['label-templates', { fileName: 'label-templates.json', kind: 'items' }],
  ['vendors', { fileName: 'vendors.json', kind: 'items' }],
  ['vendor-price-lists', { fileName: 'vendor-price-lists.json', kind: 'items' }],
  ['admin-notes', { fileName: 'admin-notes.json', kind: 'items' }],
  ['current-round', { fileName: 'current-round.json', kind: 'data' }],
  ['reports', { fileName: 'reports.json', kind: 'items' }],
]);

export function getCollectionNames() {
  return [...collections.keys()];
}

export async function readCollection(collectionName) {
  const document = await readCollectionDocument(collectionName);

  return getDocumentPayload(collectionName, document);
}

export async function readPublicLabelTemplates() {
  const templates = await readCollection('label-templates');

  return templates.filter(isPubliclyVisibleLabelTemplate);
}

export async function upsertCollectionItem(collectionName, itemId, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw createHttpError(400, 'Expected an object item.');
  }

  if (typeof item.id !== 'string' || item.id !== itemId) {
    throw createHttpError(400, 'Item id must match the URL id.');
  }

  const document = await readCollectionDocument(collectionName);
  const config = getCollectionConfig(collectionName);

  if (config.kind !== 'items') {
    throw createHttpError(400, 'Collection does not support item updates.');
  }

  const currentItems = Array.isArray(document.items) ? document.items : [];
  const nextItems = [item, ...currentItems.filter((currentItem) => currentItem?.id !== itemId)];
  const nextDocument = createCollectionDocument(collectionName, nextItems);

  await writeCollectionDocument(collectionName, nextDocument);

  return nextItems;
}

export async function deleteCollectionItem(collectionName, itemId) {
  const document = await readCollectionDocument(collectionName);
  const config = getCollectionConfig(collectionName);

  if (config.kind !== 'items') {
    throw createHttpError(400, 'Collection does not support item deletion.');
  }

  const currentItems = Array.isArray(document.items) ? document.items : [];
  const nextItems = currentItems.filter((currentItem) => currentItem?.id !== itemId);
  const nextDocument = createCollectionDocument(collectionName, nextItems);

  await writeCollectionDocument(collectionName, nextDocument);

  return nextItems;
}

export async function writeAsset(asset) {
  if (
    !asset ||
    typeof asset !== 'object' ||
    typeof asset.fileName !== 'string' ||
    typeof asset.mimeType !== 'string' ||
    typeof asset.base64 !== 'string'
  ) {
    throw createHttpError(400, 'Invalid asset upload.');
  }

  const safeFileName = asset.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const blobKey = `assets/vendor-price-sheets/${Date.now()}-${safeFileName}`;
  const assetBuffer = Buffer.from(asset.base64, 'base64');

  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    await store.set(blobKey, assetBuffer, {
      metadata: {
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      },
    });
  } else {
    const localAssetPath = path.join(localDataDir, blobKey);

    await mkdir(path.dirname(localAssetPath), { recursive: true });
    await writeFile(localAssetPath, assetBuffer);
  }

  return {
    type: 'file',
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    blobKey,
  };
}

export async function publicUpsertLabelTemplate(template) {
  const document = await readCollectionDocument('label-templates');
  const currentItems = Array.isArray(document.items) ? document.items : [];
  const nextTemplate = normalizePublicLabelTemplate(template, currentItems);
  const nextItems = [nextTemplate, ...currentItems];
  const nextDocument = createCollectionDocument('label-templates', nextItems);

  await writeCollectionDocument('label-templates', nextDocument);

  return nextItems;
}

export async function publicReportLabelTemplate(report) {
  const labelId = typeof report?.id === 'string' ? report.id.trim() : '';
  const reason = normalizeReportReason(report?.reason);
  const details = sanitizeTextField(report?.details, {
    maxLength: 400,
    fieldName: 'Report details',
    required: false,
  });

  if (!labelId || !reason) {
    throw createHttpError(400, 'Invalid label report.');
  }

  const document = await readCollectionDocument('label-templates');
  const currentItems = Array.isArray(document.items) ? document.items : [];
  let wasUpdated = false;
  const nextItems = currentItems.map((item) => {
    if (item?.id !== labelId) {
      return item;
    }

    wasUpdated = true;
    const reports = Array.isArray(item.reports) ? item.reports.slice(-49) : [];

    return {
      ...item,
      reports: [
        ...reports,
        {
          reason,
          details,
          createdAt: new Date().toISOString(),
        },
      ],
      reportCount: reports.length + 1,
      updatedAt: new Date().toISOString(),
    };
  });

  if (!wasUpdated) {
    throw createHttpError(404, 'Label template not found.');
  }

  await writeCollectionDocument('label-templates', createCollectionDocument('label-templates', nextItems));

  return nextItems;
}

export async function publicVoteLabelTemplate(vote) {
  const labelId = typeof vote?.id === 'string' ? vote.id.trim() : '';
  const direction = Number(vote?.direction);

  if (!labelId || (direction !== 1 && direction !== -1)) {
    throw createHttpError(400, 'Invalid label vote.');
  }

  const document = await readCollectionDocument('label-templates');
  const currentItems = Array.isArray(document.items) ? document.items : [];
  let wasUpdated = false;
  const nextItems = currentItems.map((item) => {
    if (item?.id !== labelId) {
      return item;
    }

    wasUpdated = true;

    return {
      ...item,
      votes: Math.max(0, Math.round(Number(item.votes) || 0) + direction),
      updatedAt: new Date().toISOString(),
    };
  });

  if (!wasUpdated) {
    throw createHttpError(404, 'Label template not found.');
  }

  await writeCollectionDocument('label-templates', createCollectionDocument('label-templates', nextItems));

  return nextItems;
}

export async function adminUpsertLabelTemplate(template) {
  if (!isNativeLabelTemplate(template)) {
    throw createHttpError(400, 'Invalid label template.');
  }

  const document = await readCollectionDocument('label-templates');
  const currentItems = Array.isArray(document.items) ? document.items : [];
  const currentItem = currentItems.find((item) => item?.id === template.id);
  const nextTemplate = normalizeAdminLabelTemplate(template, currentItem);
  const nextItems = [nextTemplate, ...currentItems.filter((item) => item?.id !== template.id)];
  const nextDocument = createCollectionDocument('label-templates', nextItems);

  await writeCollectionDocument('label-templates', nextDocument);

  return nextItems;
}

export function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readCollectionDocument(collectionName) {
  const config = getCollectionConfig(collectionName);

  if (shouldUseNetlifyBlobs()) {
    return readBlobDocument(collectionName, config);
  }

  return readLocalDocument(collectionName, config);
}

async function writeCollectionDocument(collectionName, document) {
  const config = getCollectionConfig(collectionName);

  if (shouldUseNetlifyBlobs()) {
    await writeBlobDocument(config, document);
    return;
  }

  await writeLocalDocument(config, document);
}

function getCollectionConfig(collectionName) {
  const config = collections.get(collectionName);

  if (!config) {
    throw createHttpError(404, 'Unknown collection.');
  }

  return config;
}

async function readLocalDocument(collectionName, config) {
  await ensureLocalDocument(collectionName, config);

  try {
    return await enrichDocumentFromSeed(
      collectionName,
      config,
      normalizeDocument(collectionName, JSON.parse(await readFile(getLocalPath(config), 'utf8'))),
    );
  } catch {
    return await readSeedDocument(collectionName, config);
  }
}

async function writeLocalDocument(config, document) {
  await mkdir(localDataDir, { recursive: true });
  await writeFile(getLocalPath(config), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

async function ensureLocalDocument(collectionName, config) {
  const localPath = getLocalPath(config);

  if (existsSync(localPath)) {
    return;
  }

  await mkdir(localDataDir, { recursive: true });

  if (collectionName === 'label-templates' && existsSync(legacyLabelsPath)) {
    try {
      const legacyLabels = JSON.parse(await readFile(legacyLabelsPath, 'utf8'));

      if (Array.isArray(legacyLabels)) {
        await writeLocalDocument(config, createCollectionDocument(collectionName, legacyLabels));
        return;
      }
    } catch {
      // Fall through to seed data if the old local file is invalid.
    }
  }

  await writeLocalDocument(config, await readSeedDocument(collectionName, config));
}

async function readBlobDocument(collectionName, config) {
  const store = await getBlobStore();
  const document = await store.get(config.fileName, { type: 'json' });

  if (document) {
    return await enrichDocumentFromSeed(collectionName, config, normalizeDocument(collectionName, document));
  }

  const seedDocument = await readSeedDocument(collectionName, config);
  await store.setJSON(config.fileName, seedDocument);

  return seedDocument;
}

async function writeBlobDocument(config, document) {
  const store = await getBlobStore();
  await store.setJSON(config.fileName, document);
}

async function getBlobStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore(storeName);
}

function shouldUseNetlifyBlobs() {
  return process.env.HELIX_DATA_ADAPTER === 'netlify-blobs' || process.env.NETLIFY === 'true';
}

async function readSeedDocument(collectionName, config) {
  return normalizeDocument(
    collectionName,
    JSON.parse(await readFile(path.join(seedDir, config.fileName), 'utf8')),
  );
}

function getLocalPath(config) {
  return path.join(localDataDir, config.fileName);
}

function createCollectionDocument(collectionName, payload) {
  const config = getCollectionConfig(collectionName);
  const document = {
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  if (config.kind === 'items') {
    return { ...document, items: Array.isArray(payload) ? payload : [] };
  }

  return { ...document, data: payload ?? {} };
}

function normalizeDocument(collectionName, value) {
  const config = getCollectionConfig(collectionName);

  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.version === 'number') {
    if (config.kind === 'items') {
      const items = Array.isArray(value.items) ? value.items : [];

      return {
        version: value.version,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
        items: collectionName === 'peptides' ? items.map((item) => normalizePeptideItem(item)) : items,
      };
    }

    return {
      version: value.version,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
      data: value.data && typeof value.data === 'object' ? value.data : {},
    };
  }

  if (config.kind === 'items') {
    const items = Array.isArray(value) ? value : [];

    return createCollectionDocument(
      collectionName,
      collectionName === 'peptides' ? items.map((item) => normalizePeptideItem(item)) : items,
    );
  }

  return createCollectionDocument(collectionName, value && typeof value === 'object' ? value : {});
}

async function enrichDocumentFromSeed(collectionName, config, document) {
  if (collectionName !== 'peptides' || config.kind !== 'items' || !Array.isArray(document.items)) {
    return document;
  }

  try {
    const seedDocument = normalizeDocument(
      collectionName,
      JSON.parse(await readFile(path.join(seedDir, config.fileName), 'utf8')),
    );
    const seedItemsById = new Map(seedDocument.items.map((item) => [item.id, item]));

    return {
      ...document,
      items: document.items.map((item) => normalizePeptideItem(item, seedItemsById.get(item.id))),
    };
  } catch {
    return document;
  }
}

function normalizePeptideItem(item, seedItem = {}) {
  const mergedItem = {
    ...seedItem,
    ...item,
    description: item?.description || seedItem?.description || '',
    wikiLinks: normalizePeptideWikiLinks(item, seedItem),
  };

  delete mergedItem.peptidepediaUrl;

  return mergedItem;
}

function normalizePeptideWikiLinks(item = {}, seedItem = {}) {
  const sourceLinks = Array.isArray(item?.wikiLinks)
    ? item.wikiLinks
    : item?.peptidepediaUrl
      ? [createPeptidepediaWikiLink(item.peptidepediaUrl)]
      : Array.isArray(seedItem?.wikiLinks)
        ? seedItem.wikiLinks
        : seedItem?.peptidepediaUrl
          ? [createPeptidepediaWikiLink(seedItem.peptidepediaUrl)]
          : [];
  const links = sourceLinks
    .map((link) => normalizePeptideWikiLink(link))
    .filter(Boolean);

  return sortPeptideWikiLinks(dedupePeptideWikiLinks(links));
}

function createPeptidepediaWikiLink(url) {
  return {
    source: 'peptidepedia',
    url,
    status: 'verified',
  };
}

function normalizePeptideWikiLink(link) {
  if (!link || typeof link !== 'object' || Array.isArray(link) || typeof link.url !== 'string' || !link.url.trim()) {
    return null;
  }

  const source = ['peptidepedia', 'pep-pedia', 'other'].includes(link.source) ? link.source : 'other';
  const status = ['verified', 'suggested', 'manual'].includes(link.status) ? link.status : 'manual';

  return {
    source,
    url: link.url.trim(),
    status,
  };
}

function dedupePeptideWikiLinks(links) {
  const seen = new Set();
  const nextLinks = [];

  for (const link of links) {
    const key = `${link.source}:${link.url.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextLinks.push(link);
  }

  return nextLinks;
}

function sortPeptideWikiLinks(links) {
  const order = {
    peptidepedia: 0,
    'pep-pedia': 1,
    other: 2,
  };

  return [...links].sort((first, second) => order[first.source] - order[second.source]);
}

function getDocumentPayload(collectionName, document) {
  const config = getCollectionConfig(collectionName);
  return config.kind === 'items' ? document.items : document.data;
}

function isNativeLabelTemplate(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.id === 'string' &&
    typeof value.previewDataUrl === 'string' &&
    typeof value.previewFileName === 'string' &&
    typeof value.niimbotCode === 'string'
  );
}

function normalizePublicLabelTemplate(value, currentItems) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, 'Invalid label template.');
  }

  if (typeof value.honeypot === 'string' && value.honeypot.trim()) {
    throw createHttpError(400, 'Invalid label template.');
  }

  const formStartedAt = Number(value.formStartedAt);
  if (!Number.isFinite(formStartedAt) || Date.now() - formStartedAt < 1500) {
    throw createHttpError(400, 'Try submitting the label again.');
  }

  const now = new Date().toISOString();
  const id = createLabelTemplateId(currentItems);
  const preview = sanitizePreviewDataUrl(value.previewDataUrl);
  const peptideName = sanitizeTextField(value.peptideName, {
    maxLength: 80,
    fieldName: 'Peptide name',
    required: true,
  });

  return {
    id,
    previewDataUrl: preview.dataUrl,
    previewFileName: sanitizePreviewFileName(value.previewFileName, preview.mimeType),
    niimbotCode: sanitizeTextField(value.niimbotCode, {
      maxLength: maxLabelCodeLength,
      fieldName: 'NIIMBOT code',
      required: true,
    }),
    templateName: sanitizeTextField(value.templateName, {
      maxLength: 80,
      fieldName: 'Template name',
      required: false,
    }) || undefined,
    peptideName,
    massMg: sanitizeTextField(value.massMg, {
      maxLength: 32,
      fieldName: 'Mass',
      required: true,
    }),
    labelSize: sanitizeTextField(value.labelSize, {
      maxLength: 40,
      fieldName: 'Label size',
      required: true,
    }),
    peptideCategories: sanitizeStringArray(value.peptideCategories, {
      maxItems: 3,
      maxLength: 32,
      fieldName: 'Peptide category',
    }),
    tags: sanitizeStringArray(value.tags, {
      maxItems: 10,
      maxLength: 32,
      fieldName: 'Tag',
    }),
    votes: 0,
    moderationStatus: 'pending',
    reportCount: 0,
    reports: [],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeAdminLabelTemplate(value, currentItem = {}) {
  const now = new Date().toISOString();
  const moderationStatus = normalizeModerationStatus(value.moderationStatus ?? currentItem?.moderationStatus);
  const shouldClearReports = Boolean(value.clearReports);
  const currentReports = Array.isArray(currentItem?.reports) ? currentItem.reports : [];
  const reports = shouldClearReports || value.reportCount === 0 ? [] : currentReports;
  const { clearReports, ...templateValue } = value;

  return {
    ...currentItem,
    ...templateValue,
    id: value.id,
    previewDataUrl: sanitizePreviewDataUrl(value.previewDataUrl).dataUrl,
    previewFileName: sanitizePreviewFileName(value.previewFileName, value.previewDataUrl.split(';')[0]?.slice(5)),
    niimbotCode: sanitizeTextField(value.niimbotCode, {
      maxLength: maxLabelCodeLength,
      fieldName: 'NIIMBOT code',
      required: true,
    }),
    templateName: sanitizeTextField(value.templateName, {
      maxLength: 80,
      fieldName: 'Template name',
      required: false,
    }) || undefined,
    peptideName: sanitizeTextField(value.peptideName, {
      maxLength: 80,
      fieldName: 'Peptide name',
      required: true,
    }),
    massMg: sanitizeTextField(value.massMg, {
      maxLength: 32,
      fieldName: 'Mass',
      required: true,
    }),
    labelSize: sanitizeTextField(value.labelSize, {
      maxLength: 40,
      fieldName: 'Label size',
      required: true,
    }),
    peptideCategories: sanitizeStringArray(value.peptideCategories, {
      maxItems: 3,
      maxLength: 32,
      fieldName: 'Peptide category',
    }),
    tags: sanitizeStringArray(value.tags, {
      maxItems: 10,
      maxLength: 32,
      fieldName: 'Tag',
    }),
    votes: Math.max(0, Math.round(Number(value.votes ?? currentItem?.votes) || 0)),
    moderationStatus,
    reports,
    reportCount: reports.length,
    createdAt: typeof currentItem?.createdAt === 'string' ? currentItem.createdAt : now,
    updatedAt: now,
  };
}

function createLabelTemplateId(currentItems) {
  const currentIds = new Set(currentItems.map((item) => item?.id).filter(Boolean));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `niimbot-${Date.now()}-${randomUUID().slice(0, 8)}`;

    if (!currentIds.has(id)) {
      return id;
    }
  }

  throw createHttpError(500, 'Could not create label id.');
}

function sanitizePreviewDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    throw createHttpError(400, 'Preview image must be PNG, JPEG, or WebP.');
  }

  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/);

  if (!match) {
    throw createHttpError(400, 'Preview image must be a valid base64 data URL.');
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2];

  if (!allowedPreviewMimeTypes.has(mimeType)) {
    throw createHttpError(400, 'Preview image must be PNG, JPEG, or WebP.');
  }

  if (base64.length % 4 !== 0) {
    throw createHttpError(400, 'Preview image must be valid base64.');
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.byteLength === 0 || buffer.byteLength > maxLabelPreviewBytes) {
    throw createHttpError(400, 'Preview image must be 3 MB or smaller.');
  }

  if (!matchesImageSignature(buffer, mimeType)) {
    throw createHttpError(400, 'Preview image type does not match the file contents.');
  }

  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
  };
}

function matchesImageSignature(buffer, mimeType) {
  if (mimeType === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function sanitizePreviewFileName(value, mimeType) {
  const fallbackExtension = mimeType === 'image/jpeg' ? 'jpg' : mimeType?.replace('image/', '') || 'png';
  const rawName = typeof value === 'string' && value.trim() ? value.trim() : `label-preview.${fallbackExtension}`;
  const safeName = rawName.replace(/[^a-zA-Z0-9._ -]/g, '-').replace(/\s+/g, ' ').slice(0, 120).trim();

  if (!safeName) {
    return `label-preview.${fallbackExtension}`;
  }

  if (containsBlockedText(safeName)) {
    throw createHttpError(400, 'Preview file name contains blocked text.');
  }

  return safeName;
}

function sanitizeTextField(value, { maxLength, fieldName, required }) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

  if (required && !text) {
    throw createHttpError(400, `${fieldName} is required.`);
  }

  if (text.length > maxLength) {
    throw createHttpError(400, `${fieldName} is too long.`);
  }

  if (text && containsBlockedText(text)) {
    throw createHttpError(400, `${fieldName} contains blocked text.`);
  }

  return text;
}

function sanitizeStringArray(value, { maxItems, maxLength, fieldName }) {
  if (!Array.isArray(value)) {
    return [];
  }

  const nextValues = [];

  for (const item of value) {
    const text = sanitizeTextField(item, { maxLength, fieldName, required: false });

    if (text && !nextValues.some((currentValue) => currentValue.toLowerCase() === text.toLowerCase())) {
      nextValues.push(text);
    }

    if (nextValues.length >= maxItems) {
      break;
    }
  }

  return nextValues;
}

function normalizeReportReason(value) {
  const reason = typeof value === 'string' ? value.trim().toLowerCase() : '';

  return allowedReportReasons.has(reason) ? reason : '';
}

function normalizeModerationStatus(value) {
  return ['pending', 'approved', 'rejected'].includes(value) ? value : 'pending';
}

function isPubliclyVisibleLabelTemplate(template) {
  const status = normalizeModerationStatus(template?.moderationStatus ?? 'approved');
  const reportCount = Math.max(0, Math.round(Number(template?.reportCount) || 0));

  return status !== 'rejected' && reportCount < maxReportCountBeforeHide;
}

function containsBlockedText(value) {
  const normalizedValue = value
    .toLowerCase()
    .replace(/[@]/g, 'a')
    .replace(/[!1|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[^a-z]+/g, '');

  return blockedTextFragments.some((fragment) => normalizedValue.includes(fragment));
}
