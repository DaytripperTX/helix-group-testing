import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const seedDir = path.join(rootDir, 'data');
const localDataDir = path.join(rootDir, '.local-data');
const legacyLabelsPath = path.join(rootDir, 'dist', 'stored-data', 'labels', 'templates.json');
const storeName = 'helix-data';

const collections = new Map([
  ['peptides', { fileName: 'peptides.json', kind: 'items' }],
  ['peptide-categories', { fileName: 'peptide-categories.json', kind: 'items' }],
  ['label-templates', { fileName: 'label-templates.json', kind: 'items' }],
  ['vendors', { fileName: 'vendors.json', kind: 'items' }],
  ['vendor-price-lists', { fileName: 'vendor-price-lists.json', kind: 'items' }],
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
  if (!isNativeLabelTemplate(template)) {
    throw createHttpError(400, 'Invalid label template.');
  }

  return upsertCollectionItem('label-templates', template.id, template);
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
      return {
        version: value.version,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
        items: Array.isArray(value.items) ? value.items : [],
      };
    }

    return {
      version: value.version,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
      data: value.data && typeof value.data === 'object' ? value.data : {},
    };
  }

  if (config.kind === 'items') {
    return createCollectionDocument(collectionName, Array.isArray(value) ? value : []);
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
      items: document.items.map((item) => ({
        ...seedItemsById.get(item.id),
        ...item,
        description: item.description || seedItemsById.get(item.id)?.description || '',
        peptidepediaUrl: item.peptidepediaUrl || seedItemsById.get(item.id)?.peptidepediaUrl || '',
      })),
    };
  } catch {
    return document;
  }
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
