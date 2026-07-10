import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { compactParsedCoa, createFailedParsedCoa, doesParsedLotMatchBatch } from './coa-pdf-normalizer.mjs';
import { getCoaRoundAccess, hasCoaRoundAccess } from './helix-auth.mjs';

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
const coaPdfAssetPrefix = 'coa-pdfs/';
const coaVialImageAssetPrefix = 'coa-vial-images/';
const maxLabelPreviewBytes = 3 * 1024 * 1024;
const maxLabelCodeLength = 20 * 1024;
const maxCoaPdfBytes = 8 * 1024 * 1024;
const maxCoaVialImageBytes = 1024 * 1024;
const maxReportCountBeforeHide = 5;
const trashRetentionMs = 5 * 24 * 60 * 60 * 1000;
const allowedPreviewMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const allowedReportReasons = new Set(['offensive', 'spam', 'unsafe', 'other']);
const redactedCoaResultFields = [
  'coaNumber',
  'accessionNumber',
  'verificationUrl',
  'averageNetContent',
  'purity',
  'endotoxins',
  'heavyMetals',
  'sterility',
  'fentanyl',
  'coaFileName',
  'coaMimeType',
  'coaBlobKey',
  'coaUploadedAt',
  'vialImageAssetKey',
  'vialImageMimeType',
  'vialImageFileName',
  'vialImageSource',
  'vialImageMode',
  'vialImageExtractedAt',
  'parsedCoa',
];
const coaResultValueFields = [
  'averageNetContent',
  'purity',
  'endotoxins',
  'heavyMetals',
  'sterility',
  'fentanyl',
];
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
  ['rounds', { fileName: 'rounds.json', kind: 'items', readAccess: 'public' }],
  ['coas', { fileName: 'coas.json', kind: 'items', readAccess: 'public' }],
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

export async function readPublicCollection(collectionName, headers = {}) {
  if (collectionName === 'label-templates') {
    return await readPublicLabelTemplates();
  }

  if (collectionName === 'rounds') {
    return (await readCollection('rounds')).map(toPublicRoundItem);
  }

  if (collectionName === 'coas') {
    return await readPublicCoaCollection(headers);
  }

  return await readCollection(collectionName);
}

export async function readPublicCoaCollection(headers = {}) {
  const [coas, rounds] = await Promise.all([
    readCollection('coas'),
    readCollection('rounds'),
  ]);
  const roundAccess = getCoaRoundAccess(headers);

  return coas.map((coa) => toPublicCoaItem(coa, rounds, roundAccess));
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

export async function readCoaPdfAsset(itemId, options = {}) {
  const coas = await readCollection('coas');
  const coa = coas.find((item) => item?.id === itemId);

  if (!coa || !coa.coaBlobKey) {
    throw createHttpError(404, 'COA PDF not found.');
  }

  await assertCoaRoundAccess(coa, options);

  return {
    buffer: await readCoaPdfBuffer(coa.coaBlobKey),
    mimeType: coa.coaMimeType || 'application/pdf',
    fileName: sanitizePreviewFileName(coa.coaFileName || `${coa.id}.pdf`, 'application/pdf'),
  };
}

export async function readCoaVialImageAsset(itemId, options = {}) {
  const coas = await readCollection('coas');
  const coa = coas.find((item) => item?.id === itemId);

  if (!coa || coa.vialImageMode === 'placeholder' || !coa.vialImageAssetKey) {
    throw createHttpError(404, 'COA vial image not found.');
  }

  await assertCoaRoundAccess(coa, options);

  return {
    buffer: await readCoaVialImageBuffer(coa.vialImageAssetKey),
    mimeType: coa.vialImageMimeType || 'image/png',
    fileName: sanitizePreviewFileName(coa.vialImageFileName || `${coa.id}-vial.png`, coa.vialImageMimeType || 'image/png'),
  };
}

function toPublicRoundItem(round) {
  const resultPasscode = sanitizeRoundText(round?.resultPasscode, 120);
  const { resultPasscode: _resultPasscode, ...publicRound } = round ?? {};

  void _resultPasscode;

  return {
    ...publicRound,
    hasResultPasscode: Boolean(resultPasscode),
  };
}

function toPublicCoaItem(coa, rounds, roundAccess) {
  const round = findCoaRound(coa, rounds);
  const isResultLocked = round ? !hasCoaRoundAccess(round, roundAccess) : false;

  if (!isResultLocked) {
    return {
      ...coa,
      isResultLocked: false,
      hasRoundPasscode: Boolean(round?.resultPasscode),
    };
  }

  const publicCoa = { ...coa };

  for (const field of redactedCoaResultFields) {
    delete publicCoa[field];
  }

  return {
    ...publicCoa,
    isResultLocked: true,
    hasRoundPasscode: true,
    lockedResultStates: Object.fromEntries(
      coaResultValueFields.map((field) => [field, isPendingCoaResultValue(coa?.[field]) ? 'pending' : 'populated']),
    ),
  };
}

async function assertCoaRoundAccess(coa, { headers = {}, isAdmin = false } = {}) {
  if (isAdmin) {
    return;
  }

  const rounds = await readCollection('rounds');
  const round = findCoaRound(coa, rounds);

  if (!round || hasCoaRoundAccess(round, getCoaRoundAccess(headers))) {
    return;
  }

  throw createHttpError(403, 'Round passcode required.');
}

function findCoaRound(coa, rounds) {
  if (!coa || !Array.isArray(rounds)) {
    return null;
  }

  return rounds.find((round) => round?.id === coa.roundId) ?? null;
}

function isPendingCoaResultValue(value) {
  const cleanValue = sanitizeRoundText(value, 80).toLowerCase();

  return !cleanValue || cleanValue === 'pending' || cleanValue === '-';
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

  const normalizeOptions = collectionName === 'rounds'
    ? { peptides: await readCollection('peptides') }
    : collectionName === 'coas'
      ? {
          rounds: await readCollection('rounds'),
          requireLinked: true,
          updateTimestamp: true,
        }
      : {};
  const currentItems = Array.isArray(document.items) ? document.items : [];
  const nextItem = normalizeCollectionItem(collectionName, item, normalizeOptions);
  const nextItems = [nextItem, ...currentItems.filter((currentItem) => currentItem?.id !== itemId)];
  const nextDocument = createCollectionDocument(collectionName, nextItems);

  await writeCollectionDocument(collectionName, nextDocument);
  if (collectionName === 'coas') {
    await cleanupDetachedCoaAssets(currentItems, nextItems, {
      action: 'upsert',
      itemId,
    });
  }

  return nextItems;
}

export async function exportPeptideCollectionTransfer() {
  const items = await readCollection('peptides');

  return {
    version: 1,
    collection: 'peptides',
    exportedAt: new Date().toISOString(),
    items: items.map(normalizePeptideTransferItem),
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
  const items = [];
  const rowErrors = [];

  for (const [index, item] of transfer.items.entries()) {
    try {
      const normalizedItem = normalizePeptideImportItem(item);

      if (seenIds.has(normalizedItem.id)) {
        rowErrors.push({
          rowNumber: index + 1,
          id: normalizedItem.id,
          name: normalizedItem.name,
          error: 'Duplicate peptide id.',
        });
        continue;
      }

      seenIds.add(normalizedItem.id);
      items.push(normalizedItem);
    } catch (error) {
      rowErrors.push({
        rowNumber: index + 1,
        id: typeof item?.id === 'string' ? item.id : '',
        name: typeof item?.name === 'string' ? item.name : '',
        error: error?.message || 'Record could not be imported.',
      });
    }
  }

  if (rowErrors.length > 0) {
    throw createHttpError(400, 'Peptide import contains invalid records.', {
      failedCount: rowErrors.length,
      rowErrors,
    });
  }

  const nextDocument = createCollectionDocument('peptides', items);

  await writeCollectionDocument('peptides', nextDocument);

  return nextDocument.items;
}

export async function importPeptideBatchItems(rows) {
  if (!Array.isArray(rows)) {
    throw createHttpError(400, 'Peptide batch rows are required.');
  }

  const document = await readCollectionDocument('peptides');
  let nextItems = Array.isArray(document.items) ? document.items : [];
  const seenNames = new Set();
  const rowErrors = [];
  let savedCount = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = getImportRowNumber(row, index);
    const rowName = typeof row?.name === 'string' ? row.name.trim() : '';
    const normalizedRowName = normalizeRoundName(rowName);

    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('Row is not an object.');
      }

      if (Array.isArray(row.errors) && row.errors.length > 0) {
        throw new Error(`Row has unresolved errors: ${row.errors.join('; ')}`);
      }

      if (normalizedRowName && seenNames.has(normalizedRowName)) {
        throw new Error('Duplicate name in import.');
      }

      if (normalizedRowName) {
        seenNames.add(normalizedRowName);
      }

      const existingPeptide = findPeptideByNormalizedName(nextItems, rowName);
      const importItem = normalizePeptideImportItem({
        ...row,
        id: existingPeptide?.id || sanitizeRoundToken(row.id, 120) || createUniquePeptideId(rowName, nextItems),
        name: rowName,
      });

      nextItems = [
        importItem,
        ...nextItems.filter((currentItem) => currentItem?.id !== importItem.id),
      ];
      savedCount += 1;
    } catch (error) {
      rowErrors.push({
        rowNumber,
        id: typeof row?.id === 'string' ? row.id : '',
        name: rowName,
        error: error?.message || 'Row could not be saved.',
      });
    }
  }

  if (rowErrors.length > 0) {
    throw createHttpError(400, 'Peptide batch import contains rows that could not be saved.', {
      failedCount: rowErrors.length,
      savedCount: 0,
      rowErrors,
    });
  }

  const nextDocument = createCollectionDocument('peptides', nextItems);

  await writeCollectionDocument('peptides', nextDocument);

  return {
    items: nextDocument.items,
    savedCount,
    failedCount: 0,
    rowErrors: [],
  };
}

export async function importCoaBatchItems(rows) {
  if (!Array.isArray(rows)) {
    throw createHttpError(400, 'COA batch rows are required.');
  }

  const document = await readCollectionDocument('coas');
  const rounds = await readCollection('rounds');
  let nextItems = Array.isArray(document.items) ? document.items : [];
  const rowErrors = [];
  let savedCount = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = getImportRowNumber(row, index);

    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('Row is not an object.');
      }

      const normalizedItem = normalizeCollectionItem('coas', row, {
        rounds,
        requireLinked: true,
        updateTimestamp: true,
      });

      if (!normalizedItem) {
        throw new Error('Invalid COA entry.');
      }

      nextItems = [
        normalizedItem,
        ...nextItems.filter((currentItem) => currentItem?.id !== normalizedItem.id),
      ];
      savedCount += 1;
    } catch (error) {
      rowErrors.push({
        rowNumber,
        id: typeof row?.id === 'string' ? row.id : '',
        batchNumber: typeof row?.batchNumber === 'string' ? row.batchNumber : '',
        error: error?.message || 'COA row could not be saved.',
      });
    }
  }

  if (rowErrors.length > 0) {
    throw createHttpError(400, 'COA batch import contains rows that could not be saved.', {
      failedCount: rowErrors.length,
      savedCount: 0,
      rowErrors,
    });
  }

  const nextDocument = createCollectionDocument('coas', nextItems);

  await writeCollectionDocument('coas', nextDocument);
  await cleanupDetachedCoaAssets(Array.isArray(document.items) ? document.items : [], nextDocument.items, {
    action: 'batch-import',
    savedCount,
  });

  return {
    items: nextDocument.items,
    savedCount,
    failedCount: 0,
    rowErrors: [],
  };
}

export async function deleteCoaBatchItems(ids) {
  if (!Array.isArray(ids)) {
    throw createHttpError(400, 'COA batch delete ids are required.');
  }

  const normalizedIds = [];
  const rowErrors = [];

  for (const [index, id] of ids.entries()) {
    const rowNumber = index + 1;
    const normalizedId = sanitizeRoundToken(id, 180);

    if (!normalizedId) {
      rowErrors.push({
        rowNumber,
        id: typeof id === 'string' ? id : '',
        error: 'COA id is required.',
      });
      continue;
    }

    if (!normalizedIds.includes(normalizedId)) {
      normalizedIds.push(normalizedId);
    }
  }

  if (rowErrors.length > 0) {
    throw createHttpError(400, 'COA batch delete contains rows that could not be deleted.', {
      failedCount: rowErrors.length,
      deletedCount: 0,
      rowErrors,
    });
  }

  const document = await readCollectionDocument('coas');
  const currentItems = Array.isArray(document.items) ? document.items : [];
  const deleteIds = new Set(normalizedIds);
  const nextItems = currentItems.filter((currentItem) => !deleteIds.has(currentItem?.id));
  const deletedCount = currentItems.length - nextItems.length;
  const nextDocument = createCollectionDocument('coas', nextItems);

  await writeCollectionDocument('coas', nextDocument);
  await cleanupDetachedCoaAssets(currentItems, nextDocument.items, {
    action: 'batch-delete',
    deletedCount,
  });

  return {
    items: nextDocument.items,
    deletedCount,
    failedCount: 0,
    rowErrors: [],
  };
}

export async function importRoundBatchItems(rows) {
  if (!Array.isArray(rows)) {
    throw createHttpError(400, 'Round batch rows are required.');
  }

  const document = await readCollectionDocument('rounds');
  const peptides = await readCollection('peptides');
  let nextItems = Array.isArray(document.items) ? document.items : [];
  const rowErrors = [];
  let savedCount = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = getImportRowNumber(row, index);

    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('Row is not an object.');
      }

      const normalizedItem = normalizeCollectionItem('rounds', row, { peptides });

      nextItems = [
        normalizedItem,
        ...nextItems.filter((currentItem) => currentItem?.id !== normalizedItem.id),
      ];
      savedCount += 1;
    } catch (error) {
      rowErrors.push({
        rowNumber,
        id: typeof row?.id === 'string' ? row.id : '',
        name: typeof row?.name === 'string' ? row.name : '',
        error: error?.message || 'Round row could not be saved.',
      });
    }
  }

  if (rowErrors.length > 0) {
    throw createHttpError(400, 'Round batch import contains rows that could not be saved.', {
      failedCount: rowErrors.length,
      savedCount: 0,
      rowErrors,
    });
  }

  const nextDocument = createCollectionDocument('rounds', nextItems);

  await writeCollectionDocument('rounds', nextDocument);

  return {
    items: nextDocument.items,
    savedCount,
    failedCount: 0,
    rowErrors: [],
  };
}

export async function importPeptideCategoryBatchItems(rows) {
  if (!Array.isArray(rows)) {
    throw createHttpError(400, 'Peptide category batch rows are required.');
  }

  const document = await readCollectionDocument('peptide-categories');
  let nextItems = Array.isArray(document.items) ? document.items : [];
  const rowErrors = [];
  let savedCount = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = getImportRowNumber(row, index);

    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('Row is not an object.');
      }

      const normalizedItem = normalizeCollectionItem('peptide-categories', row);

      nextItems = [
        normalizedItem,
        ...nextItems.filter((currentItem) => currentItem?.id !== normalizedItem.id),
      ];
      savedCount += 1;
    } catch (error) {
      rowErrors.push({
        rowNumber,
        id: typeof row?.id === 'string' ? row.id : '',
        name: typeof row?.name === 'string' ? row.name : '',
        error: error?.message || 'Peptide category row could not be saved.',
      });
    }
  }

  if (rowErrors.length > 0) {
    throw createHttpError(400, 'Peptide category batch import contains rows that could not be saved.', {
      failedCount: rowErrors.length,
      savedCount: 0,
      rowErrors,
    });
  }

  const nextDocument = createCollectionDocument('peptide-categories', nextItems);

  await writeCollectionDocument('peptide-categories', nextDocument);

  return {
    items: nextDocument.items,
    savedCount,
    failedCount: 0,
    rowErrors: [],
  };
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
  if (collectionName === 'coas') {
    await cleanupDetachedCoaAssets(currentItems, nextItems, {
      action: 'delete',
      itemId,
    });
  }

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

export async function writeCoaPdfAsset(asset) {
  const uploadId = randomUUID();
  const diagnostics = {
    uploadId,
    storageAdapter: shouldUseNetlifyBlobs() ? 'netlify-blobs' : 'local-files',
    steps: [],
  };

  logCoaPdfUpload(uploadId, diagnostics, 'received', {
    fileName: typeof asset?.fileName === 'string' ? asset.fileName : '',
    mimeType: typeof asset?.mimeType === 'string' ? asset.mimeType : '',
    base64Length: typeof asset?.base64 === 'string' ? asset.base64.length : 0,
  });

  if (
    !asset ||
    typeof asset !== 'object' ||
    typeof asset.fileName !== 'string' ||
    typeof asset.mimeType !== 'string' ||
    typeof asset.base64 !== 'string'
  ) {
    logCoaPdfUpload(uploadId, diagnostics, 'invalid-upload-object', {
      hasAsset: Boolean(asset),
      fileNameType: typeof asset?.fileName,
      mimeTypeType: typeof asset?.mimeType,
      base64Type: typeof asset?.base64,
    }, 'error');
    throw createHttpError(400, 'Invalid COA PDF upload.');
  }

  if (asset.mimeType !== 'application/pdf') {
    logCoaPdfUpload(uploadId, diagnostics, 'invalid-mime-type', {
      mimeType: asset.mimeType,
    }, 'error');
    throw createHttpError(400, 'COA file must be a PDF.');
  }

  const safeFileName = asset.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const buffer = Buffer.from(asset.base64, 'base64');
  const uploadBufferSummary = summarizeBufferForDiagnostics(buffer);

  diagnostics.input = {
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    safeFileName,
    base64Length: asset.base64.length,
    ...uploadBufferSummary,
  };

  logCoaPdfUpload(uploadId, diagnostics, 'decoded-upload', diagnostics.input);

  if (buffer.length === 0 || buffer.length > maxCoaPdfBytes) {
    logCoaPdfUpload(uploadId, diagnostics, 'invalid-size', {
      byteLength: buffer.length,
      maxCoaPdfBytes,
    }, 'error');
    throw createHttpError(400, 'COA PDF is too large.');
  }

  if (buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
    logCoaPdfUpload(uploadId, diagnostics, 'invalid-pdf-header', uploadBufferSummary, 'error');
    throw createHttpError(400, 'COA file must be a valid PDF.');
  }

  const blobKey = `${coaPdfAssetPrefix}${Date.now()}-${safeFileName || 'coa.pdf'}`;

  logCoaPdfUpload(uploadId, diagnostics, 'store-start', {
    blobKey,
    storageAdapter: diagnostics.storageAdapter,
  });

  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    await store.set(blobKey, buffer, {
      metadata: {
        fileName: asset.fileName,
        mimeType: 'application/pdf',
      },
    });
  } else {
    const localAssetPath = path.join(localDataDir, blobKey);

    await mkdir(path.dirname(localAssetPath), { recursive: true });
    await writeFile(localAssetPath, buffer);
  }

  logCoaPdfUpload(uploadId, diagnostics, 'store-complete', {
    blobKey,
  });

  const storedBuffer = await verifyStoredCoaPdfAsset(blobKey, buffer, uploadId, diagnostics);
  const { parsedCoa, vialImage } = await parseStoredCoaPdf(storedBuffer, asset.fileName, uploadId, diagnostics);
  const vialImageFields = vialImage
    ? await storeCoaVialImageAsset({
        fileName: asset.fileName,
        safeFileName,
        image: vialImage,
      })
    : {};

  if (vialImage) {
    logCoaPdfUpload(uploadId, diagnostics, 'vial-image-stored', {
      width: vialImage.width,
      height: vialImage.height,
      sourceName: vialImage.sourceName,
      assetKey: vialImageFields.vialImageAssetKey,
    });
  } else {
    logCoaPdfUpload(uploadId, diagnostics, 'vial-image-not-stored', {
      reason: 'Parser did not return an extracted vial image.',
    });
  }

  diagnostics.parser = summarizeParsedCoaForDiagnostics(parsedCoa);
  logCoaPdfUpload(uploadId, diagnostics, 'complete', {
    blobKey,
    parser: diagnostics.parser,
  }, parsedCoa?.error ? 'error' : 'log');

  return {
    coaFileName: asset.fileName,
    coaMimeType: 'application/pdf',
    coaBlobKey: blobKey,
    coaUploadedAt: new Date().toISOString(),
    parsedCoa,
    diagnostics,
    ...vialImageFields,
  };
}

async function verifyStoredCoaPdfAsset(blobKey, expectedBuffer, uploadId, diagnostics) {
  logCoaPdfUpload(uploadId, diagnostics, 'verify-start', {
    blobKey,
    expectedByteLength: expectedBuffer.length,
    expectedSha256: sha256Hex(expectedBuffer),
  });

  const storedBuffer = await readCoaPdfBuffer(blobKey);
  const storedSummary = summarizeBufferForDiagnostics(storedBuffer);
  const expectedSha256 = sha256Hex(expectedBuffer);
  const hashMatches = storedSummary.sha256 === expectedSha256;
  const byteLengthMatches = storedBuffer.length === expectedBuffer.length;

  diagnostics.stored = {
    blobKey,
    ...storedSummary,
    expectedByteLength: expectedBuffer.length,
    expectedSha256,
    byteLengthMatches,
    hashMatches,
  };

  logCoaPdfUpload(uploadId, diagnostics, 'verify-complete', diagnostics.stored, hashMatches && byteLengthMatches ? 'log' : 'error');

  if (
    !byteLengthMatches ||
    !hashMatches ||
    storedBuffer.subarray(0, 5).toString('utf8') !== '%PDF-'
  ) {
    throw createHttpError(500, 'COA PDF was uploaded but could not be verified after storage.', {
      blobKey,
      expectedByteLength: expectedBuffer.length,
      storedByteLength: storedBuffer.length,
      expectedSha256,
      storedSha256: storedSummary.sha256,
    });
  }

  return storedBuffer;
}

async function parseStoredCoaPdf(buffer, fileName, uploadId, diagnostics) {
  try {
    logCoaPdfUpload(uploadId, diagnostics, 'parser-import-start', {
      fileName,
    });
    const { parseCoaPdfUploadBuffer } = await import('./coa-pdf-parser.mjs');

    logCoaPdfUpload(uploadId, diagnostics, 'parser-import-complete', {
      fileName,
    });

    const result = await parseCoaPdfUploadBuffer(buffer, {
      fileName,
      uploadId,
      log: (step, detail = {}, level = 'log') => {
        logCoaPdfUpload(uploadId, diagnostics, step, detail, level);
      },
    });

    logCoaPdfUpload(uploadId, diagnostics, 'parser-complete', {
      parsedCoa: summarizeParsedCoaForDiagnostics(result.parsedCoa),
      vialImage: result.vialImage
        ? {
            width: result.vialImage.width,
            height: result.vialImage.height,
            sourceName: result.vialImage.sourceName,
            pageNumber: result.vialImage.pageNumber,
            operatorIndex: result.vialImage.operatorIndex,
          }
        : null,
    }, result.parsedCoa?.error ? 'error' : 'log');

    return result;
  } catch (error) {
    const errorDetails = serializeErrorForDiagnostics(error);

    logCoaPdfUpload(uploadId, diagnostics, 'parser-failed', {
      fileName,
      error: errorDetails,
    }, 'error');

    return {
      parsedCoa: createFailedParsedCoa(error),
      vialImage: null,
    };
  }
}

function logCoaPdfUpload(uploadId, diagnostics, step, details = {}, level = 'log') {
  const entry = {
    at: new Date().toISOString(),
    step,
    level,
    ...sanitizeDiagnostics(details),
  };

  if (diagnostics && Array.isArray(diagnostics.steps)) {
    diagnostics.steps.push(entry);
  }

  const logPayload = {
    uploadId,
    step,
    ...sanitizeDiagnostics(details),
  };

  if (level === 'error') {
    console.error('[coa-pdf-upload]', logPayload);
    return;
  }

  if (level === 'warn') {
    console.warn('[coa-pdf-upload]', logPayload);
    return;
  }

  console.log('[coa-pdf-upload]', logPayload);
}

function summarizeBufferForDiagnostics(buffer) {
  return {
    byteLength: buffer.length,
    sha256: sha256Hex(buffer),
    headerText: buffer.subarray(0, 12).toString('latin1'),
    headerHex: buffer.subarray(0, 12).toString('hex'),
    trailerText: buffer.subarray(Math.max(0, buffer.length - 24)).toString('latin1'),
  };
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function summarizeParsedCoaForDiagnostics(parsedCoa) {
  const fields = parsedCoa?.fields && typeof parsedCoa.fields === 'object' ? parsedCoa.fields : {};

  return {
    status: parsedCoa?.error ? 'failed' : 'parsed',
    parserVersion: parsedCoa?.parserVersion,
    extractionMethod: parsedCoa?.extractionMethod,
    templateId: parsedCoa?.templateId,
    templateConfidence: parsedCoa?.templateConfidence,
    pageCount: parsedCoa?.pageCount,
    confidence: parsedCoa?.confidence,
    warnings: Array.isArray(parsedCoa?.warnings) ? parsedCoa.warnings : [],
    error: parsedCoa?.error || '',
    fieldPresence: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, Boolean(String(value ?? '').trim())]),
    ),
    snippetKeys: parsedCoa?.raw?.snippets && typeof parsedCoa.raw.snippets === 'object'
      ? Object.keys(parsedCoa.raw.snippets)
      : [],
    verificationUrlCount: Array.isArray(parsedCoa?.raw?.verificationUrls) ? parsedCoa.raw.verificationUrls.length : 0,
    vialImage: parsedCoa?.raw?.vialImage ?? null,
  };
}

function serializeErrorForDiagnostics(error) {
  if (!error || typeof error !== 'object') {
    return {
      message: String(error || 'Unknown error'),
    };
  }

  return {
    name: error.name,
    message: error.message || 'Unknown error',
    code: error.code,
    cause: error.cause?.message || (error.cause ? String(error.cause) : ''),
    stack: error.stack,
  };
}

function sanitizeDiagnostics(value) {
  if (Buffer.isBuffer(value)) {
    return {
      byteLength: value.length,
      sha256: sha256Hex(value),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map(sanitizeDiagnostics);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/base64|password|secret|token/i.test(key))
      .map(([key, entryValue]) => [key, sanitizeDiagnostics(entryValue)]),
  );
}

async function storeCoaVialImageAsset({ fileName, safeFileName, image }) {
  if (
    !image ||
    image.mimeType !== 'image/png' ||
    !Buffer.isBuffer(image.buffer) ||
    image.buffer.length === 0 ||
    image.buffer.length > maxCoaVialImageBytes
  ) {
    return {};
  }

  const cleanBaseName = (safeFileName || fileName || 'coa-vial.png')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-');
  const assetKey = `${coaVialImageAssetPrefix}${Date.now()}-${cleanBaseName || 'coa-vial'}.png`;

  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    await store.set(assetKey, image.buffer, {
      metadata: {
        fileName: `${cleanBaseName || 'coa-vial'}.png`,
        mimeType: 'image/png',
        width: String(image.width),
        height: String(image.height),
      },
    });
  } else {
    const localAssetPath = path.join(localDataDir, assetKey);

    await mkdir(path.dirname(localAssetPath), { recursive: true });
    await writeFile(localAssetPath, image.buffer);
  }

  return {
    vialImageAssetKey: assetKey,
    vialImageMimeType: 'image/png',
    vialImageFileName: `${cleanBaseName || 'coa-vial'}.png`,
    vialImageSource: 'coa-pdf',
    vialImageMode: 'extracted',
    vialImageExtractedAt: new Date().toISOString(),
  };
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

export function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }
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

async function readCoaPdfBuffer(assetKey) {
  const cleanAssetKey = normalizeCoaAssetKey(assetKey);

  if (!cleanAssetKey) {
    throw createHttpError(404, 'COA PDF not found.');
  }

  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    const asset = await store.get(cleanAssetKey, { type: 'arrayBuffer' });

    if (!asset) {
      throw createHttpError(404, 'COA PDF not found.');
    }

    return Buffer.from(asset);
  }

  try {
    return await readFile(path.join(localDataDir, cleanAssetKey));
  } catch {
    throw createHttpError(404, 'COA PDF not found.');
  }
}

async function readCoaVialImageBuffer(assetKey) {
  const cleanAssetKey = normalizeCoaVialImageAssetKey(assetKey);

  if (!cleanAssetKey) {
    throw createHttpError(404, 'COA vial image not found.');
  }

  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    const asset = await store.get(cleanAssetKey, { type: 'arrayBuffer' });

    if (!asset) {
      throw createHttpError(404, 'COA vial image not found.');
    }

    return Buffer.from(asset);
  }

  try {
    return await readFile(path.join(localDataDir, cleanAssetKey));
  } catch {
    throw createHttpError(404, 'COA vial image not found.');
  }
}

async function cleanupDetachedCoaAssets(previousItems, nextItems, context = {}) {
  const previousKeys = collectCoaAssetKeys(previousItems);
  const nextKeys = collectCoaAssetKeys(nextItems);
  const detachedKeys = [...previousKeys].filter((assetKey) => !nextKeys.has(assetKey));

  for (const assetKey of detachedKeys) {
    try {
      await deleteCoaAsset(assetKey);
    } catch (error) {
      console.error('[coa-assets] detached asset delete failed', {
        ...context,
        assetKey,
        error,
      });
    }
  }
}

function collectCoaAssetKeys(items) {
  const keys = new Set();

  if (!Array.isArray(items)) {
    return keys;
  }

  for (const item of items) {
    const pdfAssetKey = normalizeCoaAssetKey(item?.coaBlobKey);
    const vialImageAssetKey = normalizeCoaVialImageAssetKey(item?.vialImageAssetKey);

    if (pdfAssetKey) {
      keys.add(pdfAssetKey);
    }

    if (vialImageAssetKey) {
      keys.add(vialImageAssetKey);
    }
  }

  return keys;
}

async function deleteCoaAsset(assetKey) {
  const cleanAssetKey = normalizeCoaAssetKey(assetKey) || normalizeCoaVialImageAssetKey(assetKey);

  if (!cleanAssetKey) {
    return;
  }

  if (shouldUseNetlifyBlobs()) {
    const store = await getBlobStore();
    await store.delete(cleanAssetKey);
    return;
  }

  await rm(path.join(localDataDir, cleanAssetKey), { force: true });
}

function normalizeCoaVialImageAssetKey(value) {
  const cleanValue = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';

  if (!cleanValue || !cleanValue.startsWith(coaVialImageAssetPrefix) || cleanValue.includes('..')) {
    return '';
  }

  return cleanValue;
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
        items: normalizeCollectionItems(collectionName, items),
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
      normalizeCollectionItems(collectionName, items),
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

function normalizeCollectionItems(collectionName, items) {
  if (collectionName === 'peptides') {
    return items.map((item) => normalizePeptideItem(item));
  }

  if (collectionName === 'peptide-categories') {
    return items.map((item) => normalizePeptideCategoryItem(item)).filter(Boolean);
  }

  if (collectionName === 'rounds') {
    return items.map((item) => normalizeRoundItem(item)).filter(Boolean);
  }

  if (collectionName === 'coas') {
    return items.map((item) => normalizeCoaItem(item)).filter(Boolean);
  }

  return items;
}

function normalizeCollectionItem(collectionName, item, options = {}) {
  if (collectionName === 'peptides') {
    return normalizePeptideItem(item, {}, { requireBlendComponents: true });
  }

  if (collectionName === 'rounds') {
    const normalizedRound = normalizeRoundItem(item, options);

    if (!normalizedRound) {
      throw createHttpError(400, 'Invalid round.');
    }

    return normalizedRound;
  }

  if (collectionName === 'peptide-categories') {
    const normalizedCategory = normalizePeptideCategoryItem(item);

    if (!normalizedCategory) {
      throw createHttpError(400, 'Invalid peptide category.');
    }

    return normalizedCategory;
  }

  if (collectionName === 'coas') {
    const normalizedCoa = normalizeCoaItem(item, options);

    if (!normalizedCoa) {
      throw createHttpError(400, 'Invalid COA entry.');
    }

    return normalizedCoa;
  }

  return item;
}

function normalizePeptideCategoryItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const name = sanitizeRoundText(item.name, 120);
  const id = sanitizeRoundToken(item.id, 120);

  if (!id || !name) {
    return null;
  }

  return { id, name };
}

function normalizeRoundItem(item, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const id = sanitizeRoundToken(item.id, 120);

  if (!id) {
    return null;
  }

  const priceListSnapshot = normalizeRoundPriceListSnapshot(item.priceListSnapshot);

  return {
    id,
    name: sanitizeRoundText(item.name, 120) || 'Untitled round',
    status: sanitizeRoundText(item.status, 120),
    vendorId: sanitizeRoundToken(item.vendorId, 120),
    isCurrent: item.isCurrent === true,
    priceSourceMode: normalizeRoundPriceSourceMode(item.priceSourceMode, priceListSnapshot),
    startDate: normalizeDateString(item.startDate),
    endDate: normalizeDateString(item.endDate),
    targetWindow: sanitizeRoundText(item.targetWindow, 120),
    resultPasscode: sanitizeRoundText(item.resultPasscode, 120),
    participants: normalizeNonNegativeInteger(item.participants),
    roundDiscountPercent: normalizePercentage(item.roundDiscountPercent),
    priceListSnapshot,
    peptides: Array.isArray(item.peptides)
      ? item.peptides.map((row, index) => normalizeRoundPeptideRow(row, index, options.peptides, priceListSnapshot)).filter(Boolean)
      : [],
    createdAt: normalizeDateTimeString(item.createdAt),
    updatedAt: normalizeDateTimeString(item.updatedAt),
  };
}

function normalizeRoundPeptideRow(row, index, peptides, priceListSnapshot = null) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return null;
  }

  const id = sanitizeRoundToken(row.id, 160) || `row-${index + 1}`;
  const shouldResolvePeptide = Array.isArray(peptides);
  const sourceName = sanitizeRoundText(getRoundPeptideSourceName(row, priceListSnapshot), 120);
  const linkedPeptide = shouldResolvePeptide
    ? resolveRoundPeptide(row, peptides, priceListSnapshot)
    : null;

  return {
    id,
    peptideId: shouldResolvePeptide ? linkedPeptide?.id ?? '' : sanitizeRoundToken(row.peptideId, 120),
    peptideName: shouldResolvePeptide
      ? linkedPeptide?.name ? sanitizeRoundText(linkedPeptide.name, 120) : sourceName
      : sanitizeRoundText(row.peptideName, 120),
    priceListItemId: sanitizeRoundToken(row.priceListItemId, 160),
    vendorCode: sanitizeRoundText(row.vendorCode, 80),
    vendorPrice: normalizeNullableMoney(row.vendorPrice),
    vendorPriceOverridden: row.vendorPriceOverridden === true,
    mass: sanitizeRoundText(row.mass, 60),
    testingTier: normalizeTestingTier(row.testingTier),
    additionalTesting: sanitizeRoundText(row.additionalTesting, 160),
    batchConformity: row.batchConformity === true,
    capColor: sanitizeRoundText(row.capColor, 60),
    notes: sanitizeRoundText(row.notes, 400),
    participantCount: normalizeNonNegativeInteger(row.participantCount),
    totalOrdered: normalizeNonNegativeInteger(row.totalOrdered),
  };
}

function resolveRoundPeptide(row, peptides = [], priceListSnapshot = null) {
  const knownPeptides = Array.isArray(peptides) ? peptides : [];
  const rowPeptideId = sanitizeRoundToken(row?.peptideId, 120);

  if (rowPeptideId) {
    return knownPeptides.find((peptide) => peptide?.id === rowPeptideId) ?? null;
  }

  const priceListItem = getRoundPriceListItem(row, priceListSnapshot);
  const priceListPeptideId = Array.isArray(priceListItem?.peptideIds)
    ? sanitizeRoundToken(priceListItem.peptideIds[0], 120)
    : '';

  if (priceListPeptideId) {
    const priceListPeptide = knownPeptides.find((peptide) => peptide?.id === priceListPeptideId);

    if (priceListPeptide) {
      return priceListPeptide;
    }
  }

  return findPeptideByName(getRoundPeptideSourceName(row, priceListSnapshot), knownPeptides);
}

function getRoundPeptideSourceName(row, priceListSnapshot = null) {
  const priceListItem = getRoundPriceListItem(row, priceListSnapshot);

  return priceListItem?.productName || row?.peptideName || '';
}

function getRoundPriceListItem(row, priceListSnapshot = null) {
  const priceListItemId = sanitizeRoundToken(row?.priceListItemId, 160);

  return priceListItemId && Array.isArray(priceListSnapshot?.items)
    ? priceListSnapshot.items.find((item) => item?.id === priceListItemId) ?? null
    : null;
}

function findPeptideByName(name, peptides = []) {
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
    .map((variant) => normalizeRoundName(variant))
    .filter(Boolean)
    .filter((variant, index, variants) => variants.indexOf(variant) === index);
}

function normalizeRoundName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeCoaItem(item, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const id = sanitizeRoundToken(item.id, 180);
  const batchNumber = sanitizeRoundText(item.batchNumber, 160);

  if (!id || !batchNumber) {
    return null;
  }

  const roundLink = resolveCoaRoundLink(item, options.rounds);

  if (options.requireLinked && !roundLink) {
    throw createHttpError(400, 'COA entry must link to a round peptide.');
  }

  const sourceRound = roundLink?.round;
  const sourceRow = roundLink?.row;
  const code = sanitizeRoundText(item.code || sourceRow?.vendorCode, 80);

  if (options.requireLinked && !code) {
    throw createHttpError(400, 'COA code is required.');
  }

  const now = new Date().toISOString();
  const coaBlobKey = normalizeCoaAssetKey(item.coaBlobKey);
  const vialImageAssetKey = normalizeCoaVialImageAssetKey(item.vialImageAssetKey);
  const parsedCoa = item.parsedCoa && typeof item.parsedCoa === 'object' && !Array.isArray(item.parsedCoa)
    ? compactParsedCoa(item.parsedCoa)
    : null;
  const vialImageMode = item.vialImageMode === 'placeholder' || isRejectedLegacyCoaVialImage(parsedCoa)
    ? 'placeholder'
    : 'extracted';

  if (parsedCoa && !doesParsedLotMatchBatch(parsedCoa, batchNumber)) {
    throw createHttpError(400, 'Parsed COA lot does not match the COA batch number.');
  }

  return {
    id,
    roundId: sanitizeRoundToken(sourceRound?.id ?? item.roundId, 120),
    roundName: sanitizeRoundText(sourceRound?.name ?? item.roundName, 120),
    roundPeptideId: sanitizeRoundToken(sourceRow?.id ?? item.roundPeptideId, 160),
    peptideId: sanitizeRoundToken(sourceRow?.peptideId ?? item.peptideId, 120),
    peptideName: sanitizeRoundText(sourceRow?.peptideName ?? item.peptideName, 120),
    code,
    batchNumber,
    capColor: sanitizeRoundText(item.capColor, 60) || 'TBD',
    mass: sanitizeRoundText(sourceRow?.mass ?? item.mass, 60),
    testingTier: normalizeTestingTier(sourceRow?.testingTier ?? item.testingTier),
    dateTested: sanitizeRoundText(item.dateTested, 80),
    lab: sanitizeRoundText(item.lab, 120),
    coaNumber: sanitizeRoundText(item.coaNumber, 80),
    accessionNumber: sanitizeRoundText(item.accessionNumber, 80),
    verificationUrl: sanitizeRoundText(item.verificationUrl, 240),
    averageNetContent: sanitizeRoundText(item.averageNetContent, 80) || 'Pending',
    purity: sanitizeRoundText(item.purity, 80) || 'Pending',
    endotoxins: sanitizeRoundText(item.endotoxins, 80) || 'Pending',
    heavyMetals: sanitizeRoundText(item.heavyMetals, 80) || 'Pending',
    sterility: sanitizeRoundText(item.sterility, 80) || 'Pending',
    fentanyl: sanitizeRoundText(item.fentanyl, 80) || 'Pending',
    ...(coaBlobKey
      ? {
          coaFileName: sanitizeRoundText(item.coaFileName, 180) || `${id}.pdf`,
          coaMimeType: item.coaMimeType === 'application/pdf' ? 'application/pdf' : 'application/pdf',
          coaBlobKey,
          coaUploadedAt: normalizeDateTimeString(item.coaUploadedAt) || now,
        }
      : {}),
    ...(vialImageAssetKey
      ? {
          vialImageAssetKey,
          vialImageMimeType: item.vialImageMimeType === 'image/png' ? 'image/png' : 'image/png',
          vialImageFileName: sanitizeRoundText(item.vialImageFileName, 180) || `${id}-vial.png`,
          vialImageSource: item.vialImageSource === 'coa-pdf' ? 'coa-pdf' : 'coa-pdf',
          vialImageMode,
          vialImageExtractedAt: normalizeDateTimeString(item.vialImageExtractedAt) || now,
        }
      : {}),
    ...(parsedCoa ? { parsedCoa } : {}),
    createdAt: normalizeDateTimeString(item.createdAt) || now,
    updatedAt: options.updateTimestamp
      ? now
      : normalizeDateTimeString(item.updatedAt) || normalizeDateTimeString(item.createdAt) || now,
  };
}

function isRejectedLegacyCoaVialImage(parsedCoa) {
  const image = parsedCoa?.raw?.vialImage;

  return parsedCoa?.templateId === 'ils_laboratories_coa'
    && image
    && (
      Number(image.operatorIndex) < 300 ||
      Number(image.drawnX) < 430 ||
      (Number(image.width) <= 260 && Number(image.height) <= 280)
    );
}

function resolveCoaRoundLink(item, rounds) {
  if (!Array.isArray(rounds)) {
    return null;
  }

  const roundId = sanitizeRoundToken(item?.roundId, 120);
  const roundPeptideId = sanitizeRoundToken(item?.roundPeptideId, 160);
  const round = rounds.find((currentRound) => currentRound?.id === roundId);

  if (!round || !Array.isArray(round.peptides)) {
    return null;
  }

  const row = round.peptides.find((currentRow) => currentRow?.id === roundPeptideId);

  return row ? { round, row } : null;
}

function normalizeCoaAssetKey(value) {
  const cleanValue = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';

  if (
    !cleanValue ||
    !cleanValue.startsWith(coaPdfAssetPrefix) ||
    cleanValue.includes('..') ||
    !/^[a-zA-Z0-9._/-]+$/.test(cleanValue)
  ) {
    return '';
  }

  return cleanValue;
}

function normalizeRoundPriceListSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }

  return {
    id: sanitizeRoundToken(snapshot.id, 160),
    vendorId: sanitizeRoundToken(snapshot.vendorId, 120),
    vendorName: sanitizeRoundText(snapshot.vendorName, 120),
    source: normalizeRoundPriceListSource(snapshot.source),
    parsedAt: normalizeDateTimeString(snapshot.parsedAt),
    items: Array.isArray(snapshot.items)
      ? snapshot.items.map((item, index) => normalizeRoundPriceListItem(item, index)).filter(Boolean)
      : [],
  };
}

function normalizeRoundPriceListSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  if (source.type === 'google-sheet') {
    return {
      type: 'google-sheet',
      url: sanitizeRoundText(source.url, 400),
    };
  }

  if (source.type === 'file') {
    return {
      type: 'file',
      fileName: sanitizeRoundText(source.fileName, 160),
      mimeType: sanitizeRoundText(source.mimeType, 120),
      blobKey: sanitizeRoundText(source.blobKey, 240),
    };
  }

  return null;
}

function normalizeRoundPriceListItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  return {
    id: sanitizeRoundToken(item.id, 160) || `price-row-${index + 1}`,
    vendorCode: sanitizeRoundText(item.vendorCode, 80),
    productName: sanitizeRoundText(item.productName, 120),
    mass: sanitizeRoundText(item.mass, 60),
    price: normalizeNullableMoney(item.price),
    vialsPerPack: Math.max(1, normalizeNonNegativeInteger(item.vialsPerPack) || 1),
    peptideIds: sanitizeRoundTokenArray(item.peptideIds, 20, 120),
    needsReview: item.needsReview === true,
  };
}

function sanitizeRoundText(value, maxLength) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

function sanitizeRoundToken(value, maxLength) {
  return typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, maxLength) : '';
}

function sanitizeRoundTokenArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  const nextValues = [];

  for (const item of value) {
    const token = sanitizeRoundToken(item, maxLength);

    if (token && !nextValues.includes(token)) {
      nextValues.push(token);
    }

    if (nextValues.length >= maxItems) {
      break;
    }
  }

  return nextValues;
}

function normalizeDateString(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const cleanValue = value.trim();
  const numericMatch = cleanValue.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/);

  if (numericMatch) {
    const [, firstPart, secondPart, thirdPart] = numericMatch;
    const firstNumber = Number(firstPart);
    const secondNumber = Number(secondPart);
    const thirdNumber = Number(thirdPart);

    if (firstPart.length === 4) {
      return formatRoundDateParts(secondNumber, thirdNumber, firstNumber);
    }

    return formatRoundDateParts(firstNumber, secondNumber, normalizeRoundDateYear(thirdNumber));
  }

  const timestamp = Date.parse(cleanValue);

  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const parsedDate = new Date(timestamp);

  return formatRoundDateParts(parsedDate.getUTCMonth() + 1, parsedDate.getUTCDate(), parsedDate.getUTCFullYear());
}

function normalizeRoundDateYear(year) {
  if (year < 100) {
    return year >= 70 ? 1900 + year : 2000 + year;
  }

  return year;
}

function formatRoundDateParts(month, day, year) {
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return '';
  }

  const displayMonth = String(month).padStart(2, '0');
  const displayDay = String(day).padStart(2, '0');
  const displayYear = String(year % 100).padStart(2, '0');

  return `${displayMonth}/${displayDay}/${displayYear}`;
}

function normalizeDateTimeString(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function normalizeTestingTier(value) {
  return ['platinum', 'gold', 'gold-plus', 'bronze'].includes(value) ? value : 'none';
}

function normalizeRoundPriceSourceMode(value, priceListSnapshot) {
  if (value === 'vendor-default' || value === 'round-override') {
    return value;
  }

  return priceListSnapshot ? 'round-override' : 'none';
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizeNullableMoney(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : null;
}

function normalizePercentage(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
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

  const invalidFields = [];

  if (!id) {
    invalidFields.push('missing id');
  }

  if (!name) {
    invalidFields.push('missing name');
  }

  if (invalidFields.length > 0) {
    throw createHttpError(400, `Invalid peptide record: ${invalidFields.join(', ')}.`);
  }

  return normalizePeptideItem({
    ...item,
    id,
    name,
    categories,
    description: typeof item.description === 'string' ? item.description.trim() : '',
  }, {}, { requireBlendComponents: true });
}

function normalizePeptideTransferItem(item) {
  return {
    ...item,
    categories: Array.isArray(item?.categories) ? item.categories : [],
  };
}

function getImportRowNumber(row, index) {
  const parsedRowNumber = Number(row?.rowNumber);

  return Number.isFinite(parsedRowNumber) && parsedRowNumber > 0
    ? Math.trunc(parsedRowNumber)
    : index + 1;
}

function createUniquePeptideId(name, items) {
  const baseId = slugifyPeptideId(name) || `peptide-${Date.now()}`;
  const usedIds = new Set(items.map((item) => item?.id).filter(Boolean));
  let nextId = baseId;
  let suffix = 2;

  while (usedIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

function findPeptideByNormalizedName(items, name) {
  const normalizedName = normalizeRoundName(name);

  return items.find((item) => normalizeRoundName(item?.name) === normalizedName) ?? null;
}

function slugifyPeptideId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function normalizePeptideItem(item, seedItem = {}, options = {}) {
  const kind = normalizePeptideKind(item?.kind ?? seedItem?.kind);
  const components = normalizeBlendComponents(item?.components ?? seedItem?.components);

  if (options.requireBlendComponents && kind === 'blend' && components.length === 0) {
    throw createHttpError(400, 'Blend components are required.');
  }

  const mergedItem = {
    ...seedItem,
    ...item,
    kind,
    description: item?.description || seedItem?.description || '',
    components: kind === 'blend' ? components : [],
    wikiLinks: normalizePeptideWikiLinks(item, seedItem),
  };

  delete mergedItem.peptidepediaUrl;

  return mergedItem;
}

function normalizePeptideKind(value) {
  return value === 'blend' ? 'blend' : 'peptide';
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

    const peptideId = sanitizeRoundToken(component.peptideId, 120);
    const name = sanitizeTextField(component.name, {
      maxLength: 120,
      fieldName: 'Blend component name',
      required: false,
    });
    const ratio = sanitizeTextField(component.ratio, {
      maxLength: 80,
      fieldName: 'Blend component ratio',
      required: false,
    });

    if (!name) {
      continue;
    }

    const key = peptideId || name.toLowerCase();

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    components.push({ peptideId, name, ratio });
  }

  return components;
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
