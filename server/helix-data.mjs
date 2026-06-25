import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';

const rootDir = process.env.HELIX_ROOT_DIR
  ? path.resolve(process.env.HELIX_ROOT_DIR)
  : process.cwd();
const seedDir = path.join(rootDir, 'data');
const localDataDir = process.env.HELIX_LOCAL_DATA_DIR
  ? path.resolve(process.env.HELIX_LOCAL_DATA_DIR)
  : path.join(rootDir, '.local-data');
const legacyLabelsPath = path.join(rootDir, 'dist', 'stored-data', 'labels', 'templates.json');
const storeName = 'helix-data';
const labelTemplateOverridePrefix = 'label-template-overrides/';
const maxLabelPreviewBytes = 3 * 1024 * 1024;
const maxLabelCodeLength = 20 * 1024;
const maxReportCountBeforeHide = 5;
const trashRetentionMs = 5 * 24 * 60 * 60 * 1000;
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
  ['peptides', { fileName: 'peptides.json', kind: 'items', readAccess: 'public' }],
  ['peptide-categories', { fileName: 'peptide-categories.json', kind: 'items', readAccess: 'public' }],
  ['label-templates', { fileName: 'label-templates.json', kind: 'items', readAccess: 'public' }],
  ['vendors', { fileName: 'vendors.json', kind: 'items', readAccess: 'public' }],
  ['vendor-price-lists', { fileName: 'vendor-price-lists.json', kind: 'items', readAccess: 'public' }],
  ['admin-notes', { fileName: 'admin-notes.json', kind: 'items', readAccess: 'admin' }],
  ['current-round', { fileName: 'current-round.json', kind: 'data', readAccess: 'public' }],
  ['reports', { fileName: 'reports.json', kind: 'items', readAccess: 'admin' }],
]);

export function getCollectionNames() {
  return [...collections.keys()];
}

export function isPublicCollectionRead(collectionName) {
  return getCollectionConfig(collectionName).readAccess === 'public';
}

export async function readCollection(collectionName) {
  if (collectionName === 'label-templates') {
    const document = await readLabelTemplateDocument();

    return document.items;
  }

  const document = await readCollectionDocument(collectionName);

  return getDocumentPayload(collectionName, document);
}

export async function readPublicLabelTemplates() {
  const templates = await readCollection('label-templates');

  return templates.filter(isPubliclyVisibleLabelTemplate).map(toPublicLabelTemplate);
}

export async function readLabelTemplatePreviewAsset(itemId, { isAdmin = false } = {}) {
  const document = await readLabelTemplateDocument();
  const template = document.items.find((item) => item?.id === itemId);

  if (!template) {
    throw createHttpError(404, 'Label preview not found.');
  }

  if (!isAdmin && !isPubliclyVisibleLabelTemplate(template)) {
    throw createHttpError(404, 'Label preview not found.');
  }

  if (typeof template.previewDataUrl === 'string') {
    const preview = sanitizePreviewDataUrl(template.previewDataUrl);

    return {
      buffer: preview.buffer,
      mimeType: preview.mimeType,
      fileName: sanitizePreviewFileName(template.previewFileName, preview.mimeType),
    };
  }

  if (typeof template.previewAssetKey !== 'string' || typeof template.previewMimeType !== 'string') {
    throw createHttpError(404, 'Label preview not found.');
  }

  return {
    buffer: await readLabelPreviewAsset(template.previewAssetKey),
    mimeType: template.previewMimeType,
    fileName: sanitizePreviewFileName(template.previewFileName, template.previewMimeType),
  };
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
  const nextItem = normalizeCollectionItem(collectionName, item);
  const nextItems = [nextItem, ...currentItems.filter((currentItem) => currentItem?.id !== itemId)];
  const nextDocument = createCollectionDocument(collectionName, nextItems);

  await writeCollectionDocument(collectionName, nextDocument);

  return nextItems;
}

export async function exportPeptideCollectionTransfer() {
  return {
    version: 1,
    collection: 'peptides',
    exportedAt: new Date().toISOString(),
    items: await readCollection('peptides'),
  };
}

export async function importPeptideCollectionTransfer(transfer) {
  if (!transfer || typeof transfer !== 'object' || Array.isArray(transfer)) {
    throw createHttpError(400, 'Invalid peptide import file.');
  }

  if (transfer.collection !== 'peptides' || !Array.isArray(transfer.items)) {
    throw createHttpError(400, 'Invalid peptide import file.');
  }

  const seenIds = new Set();
  const items = transfer.items.map((item) => normalizePeptideImportItem(item));

  for (const item of items) {
    if (seenIds.has(item.id)) {
      throw createHttpError(400, 'Peptide import contains duplicate ids.');
    }

    seenIds.add(item.id);
  }

  const nextDocument = createCollectionDocument('peptides', items);

  await writeCollectionDocument('peptides', nextDocument);

  return nextDocument.items;
}

export async function deleteCollectionItem(collectionName, itemId) {
  if (collectionName === 'label-templates') {
    return softDeleteLabelTemplate(itemId, 'admin');
  }

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
  const currentItems = await readCollection('label-templates');
  const baseDocument = await readCollectionDocument('label-templates');
  const baseItems = Array.isArray(baseDocument.items) ? baseDocument.items.map(normalizeStoredLabelTemplate) : [];
  const nextTemplate = await normalizePublicLabelTemplate(template, currentItems);
  const nextItems = [nextTemplate, ...baseItems];
  const nextDocument = createCollectionDocument('label-templates', nextItems);

  await writeCollectionDocument('label-templates', nextDocument);

  return [nextTemplate, ...currentItems];
}

export async function publicReportLabelTemplate(report, headers = {}) {
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

  const fingerprint = createLabelActionFingerprint(headers, labelId, 'report');
  const item = await findLabelTemplate(labelId);

  if (!item) {
    throw createHttpError(404, 'Label template not found.');
  }

  const reports = Array.isArray(item.reports) ? item.reports.slice(-49) : [];
  const reportFingerprints = normalizeFingerprintList(item.reportFingerprints);

  if (reportFingerprints.includes(fingerprint)) {
    return await readCollection('label-templates');
  }

  const nextReports = [
    ...reports,
    {
      reason,
      details,
      fingerprint,
      createdAt: new Date().toISOString(),
    },
  ];
  const nextReportFingerprints = [...reportFingerprints, fingerprint].slice(-50);
  const nextItem = normalizeStoredLabelTemplate({
    ...item,
    reports: nextReports,
    reportFingerprints: nextReportFingerprints,
    reportCount: nextReportFingerprints.length,
    updatedAt: new Date().toISOString(),
  });

  await writeLabelTemplateOverride(nextItem);

  return [nextItem, ...(await readCollection('label-templates')).filter((currentItem) => currentItem?.id !== labelId)];
}

export async function publicVoteLabelTemplate(vote, headers = {}) {
  const labelId = typeof vote?.id === 'string' ? vote.id.trim() : '';
  const direction = Number(vote?.direction);

  if (!labelId || (direction !== 1 && direction !== -1)) {
    throw createHttpError(400, 'Invalid label vote.');
  }

  const fingerprint = createLabelActionFingerprint(headers, labelId, 'vote');
  const item = await findLabelTemplate(labelId);

  if (!item) {
    throw createHttpError(404, 'Label template not found.');
  }

  const voteFingerprints = normalizeFingerprintList(item.voteFingerprints);
  const hasVoted = voteFingerprints.includes(fingerprint);
  const nextVoteFingerprints =
    direction === 1
      ? hasVoted ? voteFingerprints : [...voteFingerprints, fingerprint]
      : voteFingerprints.filter((currentFingerprint) => currentFingerprint !== fingerprint);
  const nextItem = normalizeStoredLabelTemplate({
    ...item,
    voteFingerprints: nextVoteFingerprints,
    votes: nextVoteFingerprints.length,
    updatedAt: new Date().toISOString(),
  });

  await writeLabelTemplateOverride(nextItem);

  return [nextItem, ...(await readCollection('label-templates')).filter((currentItem) => currentItem?.id !== labelId)];
}

export async function adminUpsertLabelTemplate(template) {
  if (!isNativeLabelTemplate(template)) {
    throw createHttpError(400, 'Invalid label template.');
  }

  const currentItem = await findLabelTemplate(template.id);

  if (!currentItem) {
    throw createHttpError(404, 'Label template not found.');
  }

  const nextTemplate = await normalizeAdminLabelTemplate(template, currentItem);

  await writeLabelTemplateOverride(nextTemplate);

  return nextTemplate;
}

export async function recoverLabelTemplate(itemId) {
  const item = await findLabelTemplate(itemId);

  if (!item) {
    throw createHttpError(404, 'Label template not found.');
  }

  const { deletedAt, deletedReason, ...nextItem } = item;
  const recoveredItem = normalizeStoredLabelTemplate({
    ...nextItem,
    moderationStatus: 'unreviewed',
    updatedAt: new Date().toISOString(),
  });

  await writeLabelTemplateOverride(recoveredItem);

  return recoveredItem;
}

export async function permanentlyDeleteLabelTemplate(itemId) {
  return hardDeleteLabelTemplate(itemId);
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

async function readLabelTemplateOverrides() {
  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    const result = await store.list({ prefix: labelTemplateOverridePrefix });
    const overrides = [];

    for (const blob of result.blobs ?? []) {
      const override = await store.get(blob.key, { type: 'json' });

      if (override && typeof override === 'object' && !Array.isArray(override)) {
        overrides.push(override);
      }
    }

    return overrides;
  }

  const overrideDir = path.join(localDataDir, labelTemplateOverridePrefix);

  try {
    const entries = await readdir(overrideDir, { withFileTypes: true });
    const overrides = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      try {
        const override = JSON.parse(await readFile(path.join(overrideDir, entry.name), 'utf8'));

        if (override && typeof override === 'object' && !Array.isArray(override)) {
          overrides.push(override);
        }
      } catch {
        // Ignore corrupt override records and keep the base collection readable.
      }
    }

    return overrides;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function writeLabelTemplateOverride(item) {
  if (!item?.id || typeof item.id !== 'string') {
    throw createHttpError(400, 'Invalid label template override.');
  }

  const key = createLabelTemplateOverrideKey(item.id);

  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    await store.setJSON(key, item);
    return item;
  }

  const localPath = path.join(localDataDir, key);

  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, `${JSON.stringify(item, null, 2)}\n`, 'utf8');

  return item;
}

function createLabelTemplateOverrideKey(itemId) {
  return `${labelTemplateOverridePrefix}${encodeURIComponent(itemId)}.json`;
}

async function writeLabelPreviewAsset(assetKey, buffer, metadata) {
  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    await store.set(assetKey, buffer, { metadata });
    return;
  }

  const localAssetPath = path.join(localDataDir, assetKey);

  await mkdir(path.dirname(localAssetPath), { recursive: true });
  await writeFile(localAssetPath, buffer);
}

async function readLabelPreviewAsset(assetKey) {
  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    const asset = await store.get(assetKey, { type: 'arrayBuffer' });

    if (!asset) {
      throw createHttpError(404, 'Label preview not found.');
    }

    return Buffer.from(asset);
  }

  try {
    return await readFile(path.join(localDataDir, assetKey));
  } catch {
    throw createHttpError(404, 'Label preview not found.');
  }
}

async function getBlobStore() {
  const { getStore } = await import('@netlify/blobs');

  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({
      name: storeName,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
      consistency: 'strong',
    });
  }

  if (hasUncachedBlobContext()) {
    return getStore(storeName, { consistency: 'strong' });
  }

  return getStore(storeName);
}

function hasUncachedBlobContext() {
  const context = globalThis.netlifyBlobsContext ?? readNetlifyBlobsContext();

  return Boolean(context && typeof context === 'object' && context.uncachedEdgeURL);
}

function readNetlifyBlobsContext() {
  if (!process.env.NETLIFY_BLOBS_CONTEXT) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(process.env.NETLIFY_BLOBS_CONTEXT, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function shouldUseNetlifyBlobs() {
  if (process.env.HELIX_DATA_ADAPTER === 'local') {
    return false;
  }

  return (
    process.env.HELIX_DATA_ADAPTER === 'netlify-blobs' ||
    process.env.NETLIFY === 'true' ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.LAMBDA_TASK_ROOT)
  );
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

async function readLabelTemplateDocument() {
  const document = await readCollectionDocument('label-templates');
  const items = Array.isArray(document.items) ? document.items.map(normalizeStoredLabelTemplate) : [];
  const activeItems = purgeExpiredTrash(items);
  const migration = await migrateLegacyLabelPreviews(activeItems);
  const overrides = await readLabelTemplateOverrides();
  const mergedItems = mergeLabelTemplateOverrides(migration.items, overrides);
  const activeMergedItems = purgeExpiredTrash(mergedItems);
  const expiredMergedItems = mergedItems.filter((item) =>
    item?.id && !activeMergedItems.some((activeItem) => activeItem?.id === item.id),
  );
  const nextDocument = createCollectionDocument('label-templates', activeMergedItems);

  if (
    migration.wasChanged ||
    activeItems.length !== items.length ||
    JSON.stringify(items) !== JSON.stringify(document.items)
  ) {
    await writeCollectionDocument('label-templates', createCollectionDocument('label-templates', migration.items));
  }

  for (const expiredItem of expiredMergedItems) {
    await writeLabelTemplateOverride(createLabelTemplateTombstone(expiredItem.id));
  }

  return nextDocument;
}

async function findLabelTemplate(itemId) {
  const document = await readLabelTemplateDocument();

  return document.items.find((item) => item?.id === itemId);
}

function mergeLabelTemplateOverrides(baseItems, overrides) {
  const activeOverrides = [];
  const tombstoneIds = new Set();

  for (const override of overrides) {
    if (isLabelTemplateTombstone(override)) {
      tombstoneIds.add(override.id);
      continue;
    }

    if (override?.id) {
      activeOverrides.push(normalizeStoredLabelTemplate(override));
    }
  }

  const overridesById = new Map(activeOverrides.map((item) => [item.id, item]));
  const mergedItems = [];
  const seenIds = new Set();

  for (const item of baseItems) {
    if (!item?.id || tombstoneIds.has(item.id)) {
      continue;
    }

    const nextItem = overridesById.get(item.id) ?? item;
    mergedItems.push(nextItem);
    seenIds.add(item.id);
  }

  for (const override of activeOverrides) {
    if (!seenIds.has(override.id) && !tombstoneIds.has(override.id)) {
      mergedItems.push(override);
    }
  }

  return mergedItems;
}

function normalizeCollectionItem(collectionName, item) {
  return collectionName === 'peptides' ? normalizePeptideItem(item) : item;
}

function normalizePeptideImportItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw createHttpError(400, 'Peptide import contains invalid records.');
  }

  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const categories = Array.isArray(item.categories)
    ? item.categories
      .map((category) => String(category ?? '').trim())
      .filter(Boolean)
      .filter((category, index, categoryList) => categoryList.indexOf(category) === index)
    : [];

  if (!id || !name || categories.length === 0) {
    throw createHttpError(400, 'Peptide import contains invalid records.');
  }

  return normalizePeptideItem({
    ...item,
    id,
    name,
    categories,
    description: typeof item.description === 'string' ? item.description.trim() : '',
  });
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

  const url = normalizeHttpUrl(link.url);

  if (!url) {
    return null;
  }

  const source = ['peptidepedia', 'pep-pedia', 'other'].includes(link.source) ? link.source : 'other';
  const status = ['verified', 'suggested', 'manual'].includes(link.status) ? link.status : 'manual';

  return {
    source,
    url,
    status,
  };
}

function normalizeHttpUrl(value) {
  const cleanValue = String(value ?? '').trim();

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
    (typeof value.previewDataUrl === 'string' || typeof value.previewAssetKey === 'string') &&
    typeof value.previewFileName === 'string' &&
    typeof value.niimbotCode === 'string'
  );
}

async function normalizePublicLabelTemplate(value, currentItems) {
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
  const previewFields = await storeLabelPreview(id, preview, value.previewFileName);
  const peptideName = sanitizeTextField(value.peptideName, {
    maxLength: 80,
    fieldName: 'Peptide name',
    required: true,
  });

  return {
    id,
    ...previewFields,
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
    voteFingerprints: [],
    moderationStatus: 'unreviewed',
    reportCount: 0,
    reports: [],
    reportFingerprints: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function normalizeAdminLabelTemplate(value, currentItem = {}) {
  const now = new Date().toISOString();
  const moderationStatus = normalizeModerationStatus(value.moderationStatus ?? currentItem?.moderationStatus);
  const shouldClearReports = Boolean(value.clearReports);
  const currentReports = Array.isArray(currentItem?.reports) ? currentItem.reports : [];
  const currentReportFingerprints = normalizeFingerprintList(currentItem?.reportFingerprints);
  const reports = shouldClearReports ? [] : currentReports;
  const reportFingerprints = shouldClearReports ? [] : currentReportFingerprints;
  const voteFingerprints = normalizeFingerprintList(currentItem?.voteFingerprints);
  const {
    clearReports,
    previewDataUrl,
    previewUrl,
    previewAssetKey,
    previewMimeType,
    previewByteLength,
    ...templateValue
  } = value;
  const previewFields = await normalizeAdminPreviewFields(value, currentItem);
  const nextDeletedAt =
    moderationStatus === 'rejected'
      ? typeof value.deletedAt === 'string'
        ? value.deletedAt
        : typeof currentItem?.deletedAt === 'string'
          ? currentItem.deletedAt
          : now
      : typeof value.deletedAt === 'string' ? value.deletedAt : undefined;
  const nextDeletedReason =
    moderationStatus === 'rejected'
      ? 'rejected'
      : value.deletedReason === 'admin' ? 'admin' : value.deletedReason === 'rejected' ? 'rejected' : undefined;

  const nextItem = {
    ...currentItem,
    ...templateValue,
    id: value.id,
    ...previewFields,
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
    voteFingerprints,
    votes: voteFingerprints.length || Math.max(0, Math.round(Number(currentItem?.votes ?? value.votes) || 0)),
    moderationStatus,
    reports,
    reportFingerprints,
    reportCount: reportFingerprints.length || reports.length,
    createdAt: typeof currentItem?.createdAt === 'string' ? currentItem.createdAt : now,
    updatedAt: now,
  };

  if (nextDeletedAt) {
    nextItem.deletedAt = nextDeletedAt;
  } else {
    delete nextItem.deletedAt;
  }

  if (nextDeletedReason) {
    nextItem.deletedReason = nextDeletedReason;
  } else {
    delete nextItem.deletedReason;
  }

  return normalizeStoredLabelTemplate(nextItem);
}

async function normalizeAdminPreviewFields(value, currentItem = {}) {
  if (typeof value.previewDataUrl === 'string' && value.previewDataUrl.startsWith('data:')) {
    const preview = sanitizePreviewDataUrl(value.previewDataUrl);
    return storeLabelPreview(value.id, preview, value.previewFileName);
  }

  if (typeof currentItem.previewAssetKey === 'string' && typeof currentItem.previewMimeType === 'string') {
    return {
      previewAssetKey: currentItem.previewAssetKey,
      previewMimeType: currentItem.previewMimeType,
      previewFileName: sanitizePreviewFileName(value.previewFileName, currentItem.previewMimeType),
      previewByteLength: Math.max(0, Math.round(Number(currentItem.previewByteLength) || 0)),
      previewUrl: createLabelPreviewUrl(value.id),
    };
  }

  if (typeof value.previewAssetKey === 'string' && typeof value.previewMimeType === 'string') {
    return {
      previewAssetKey: value.previewAssetKey,
      previewMimeType: value.previewMimeType,
      previewFileName: sanitizePreviewFileName(value.previewFileName, value.previewMimeType),
      previewByteLength: Math.max(0, Math.round(Number(value.previewByteLength) || 0)),
      previewUrl: createLabelPreviewUrl(value.id),
    };
  }

  throw createHttpError(400, 'Preview image must be PNG, JPEG, or WebP.');
}

async function migrateLegacyLabelPreviews(items) {
  let wasChanged = false;
  const nextItems = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      nextItems.push(item);
      continue;
    }

    if (typeof item.previewDataUrl === 'string' && item.previewDataUrl.startsWith('data:')) {
      const preview = sanitizePreviewDataUrl(item.previewDataUrl);
      const previewFields = await storeLabelPreview(item.id, preview, item.previewFileName);
      const { previewDataUrl, ...itemWithoutInlinePreview } = item;

      nextItems.push({
        ...itemWithoutInlinePreview,
        ...previewFields,
      });
      wasChanged = true;
      continue;
    }

    if (typeof item.previewAssetKey === 'string') {
      const nextItem = {
        ...item,
        previewUrl: createLabelPreviewUrl(item.id),
      };

      if (typeof item.previewUrl !== nextItem.previewUrl) {
        wasChanged = true;
      }

      nextItems.push(nextItem);
      continue;
    }

    nextItems.push(item);
  }

  return { items: nextItems, wasChanged };
}

async function storeLabelPreview(labelId, preview, previewFileName) {
  const previewAssetKey = createLabelPreviewAssetKey(labelId, preview.mimeType);
  const previewFileNameValue = sanitizePreviewFileName(previewFileName, preview.mimeType);

  await writeLabelPreviewAsset(previewAssetKey, preview.buffer, {
    fileName: previewFileNameValue,
    mimeType: preview.mimeType,
    byteLength: String(preview.byteLength),
  });

  return {
    previewAssetKey,
    previewMimeType: preview.mimeType,
    previewFileName: previewFileNameValue,
    previewByteLength: preview.byteLength,
    previewUrl: createLabelPreviewUrl(labelId),
  };
}

function createLabelPreviewAssetKey(labelId, mimeType) {
  const safeLabelId = String(labelId || randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '-');
  return `label-previews/${safeLabelId}.${getPreviewExtension(mimeType)}`;
}

function createLabelPreviewUrl(labelId) {
  return `/api/labels/${encodeURIComponent(labelId)}/preview`;
}

function getPreviewExtension(mimeType) {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'png';
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
    base64,
    buffer,
    byteLength: buffer.byteLength,
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
  if (value === 'pending') {
    return 'unreviewed';
  }

  return ['unreviewed', 'approved', 'rejected'].includes(value) ? value : 'unreviewed';
}

function isPubliclyVisibleLabelTemplate(template) {
  const status = normalizeModerationStatus(template?.moderationStatus ?? 'unreviewed');
  const reportCount = getDistinctReportCount(template);

  return !template?.deletedAt && status !== 'rejected' && reportCount < maxReportCountBeforeHide;
}

function softDeleteLabelTemplate(itemId, deletedReason) {
  return updateDeletedLabelTemplate(itemId, {
    moderationStatus: 'rejected',
    deletedAt: new Date().toISOString(),
    deletedReason,
  });
}

async function updateDeletedLabelTemplate(itemId, fields) {
  const item = await findLabelTemplate(itemId);

  if (!item) {
    throw createHttpError(404, 'Label template not found.');
  }

  const nextItem = normalizeStoredLabelTemplate({
    ...item,
    ...fields,
    updatedAt: new Date().toISOString(),
  });

  await writeLabelTemplateOverride(nextItem);

  return nextItem;
}

async function hardDeleteLabelTemplate(itemId) {
  const item = await findLabelTemplate(itemId);

  if (!item) {
    throw createHttpError(404, 'Label template not found.');
  }

  const tombstone = createLabelTemplateTombstone(itemId);

  await writeLabelTemplateOverride(tombstone);

  return tombstone;
}

function normalizeStoredLabelTemplate(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return item;
  }

  const reports = Array.isArray(item.reports)
    ? item.reports.map((report) => ({
        reason: normalizeReportReason(report?.reason) || 'other',
        details: typeof report?.details === 'string' ? report.details : '',
        ...(typeof report?.fingerprint === 'string' ? { fingerprint: report.fingerprint } : {}),
        createdAt: typeof report?.createdAt === 'string' ? report.createdAt : new Date().toISOString(),
      }))
    : [];
  const reportFingerprints = normalizeFingerprintList(item.reportFingerprints);
  const nextReportFingerprints = reportFingerprints.length
    ? reportFingerprints
    : normalizeFingerprintList(reports.map((report) => report.fingerprint).filter(Boolean));
  const voteFingerprints = normalizeFingerprintList(item.voteFingerprints);
  const moderationStatus = normalizeModerationStatus(item.moderationStatus);
  const nextItem = {
    ...item,
    moderationStatus,
    votes: voteFingerprints.length || Math.max(0, Math.round(Number(item.votes) || 0)),
    voteFingerprints,
    reports,
    reportFingerprints: nextReportFingerprints,
    reportCount: nextReportFingerprints.length || reports.length || Math.max(0, Math.round(Number(item.reportCount) || 0)),
  };

  if (moderationStatus === 'rejected' && !nextItem.deletedAt) {
    nextItem.deletedAt = typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString();
    nextItem.deletedReason = 'rejected';
  }

  if (typeof nextItem.deletedAt !== 'string') {
    delete nextItem.deletedAt;
    delete nextItem.deletedReason;
  } else if (!['admin', 'rejected'].includes(nextItem.deletedReason)) {
    nextItem.deletedReason = moderationStatus === 'rejected' ? 'rejected' : 'admin';
  }

  return nextItem;
}

function createLabelTemplateTombstone(itemId) {
  const now = new Date().toISOString();

  return {
    id: itemId,
    permanentlyDeleted: true,
    deletedAt: now,
    deletedReason: 'permanent',
    updatedAt: now,
  };
}

function isLabelTemplateTombstone(item) {
  return Boolean(
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.id === 'string' &&
    item.permanentlyDeleted === true,
  );
}

function purgeExpiredTrash(items) {
  const now = Date.now();

  return items.filter((item) => {
    if (!item?.deletedAt) {
      return true;
    }

    const deletedAt = Date.parse(item.deletedAt);

    return !Number.isFinite(deletedAt) || now - deletedAt < trashRetentionMs;
  });
}

function toPublicLabelTemplate(template) {
  const {
    reportFingerprints,
    voteFingerprints,
    reports,
    deletedAt,
    deletedReason,
    ...publicTemplate
  } = template;

  return publicTemplate;
}

function getDistinctReportCount(template) {
  const reportFingerprints = normalizeFingerprintList(template?.reportFingerprints);

  if (reportFingerprints.length) {
    return reportFingerprints.length;
  }

  return Math.max(0, Math.round(Number(template?.reportCount) || 0));
}

function normalizeFingerprintList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim()))];
}

function createLabelActionFingerprint(headers, labelId, action) {
  const rawValue = [
    action,
    labelId,
    getClientFingerprintSource(headers),
  ].join(':');

  return createHmac('sha256', getLabelFingerprintSecret()).update(rawValue).digest('base64url');
}

function getClientFingerprintSource(headers = {}) {
  const forwardedFor = getHeaderValue(headers, 'x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = forwardedFor || getHeaderValue(headers, 'cf-connecting-ip') || getHeaderValue(headers, 'x-real-ip') || 'local';
  const userAgent = getHeaderValue(headers, 'user-agent') || 'unknown-agent';

  return `${clientIp}:${userAgent.slice(0, 160)}`;
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

function getLabelFingerprintSecret() {
  return process.env.HELIX_LABEL_FINGERPRINT_SECRET ||
    process.env.HELIX_ADMIN_SESSION_SECRET ||
    'helix-local-label-fingerprint-secret';
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
