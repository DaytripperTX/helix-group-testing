const parserVersion = 'coa-pdf-parser-v1';
const maxRawSnippetLength = 1200;

export function createFailedParsedCoa(error) {
  return compactParsedCoa({
    parserVersion,
    extractionMethod: 'native_pdf',
    templateId: 'unknown',
    templateConfidence: 0,
    matchedAnchors: [],
    pageCount: 0,
    confidence: 0,
    fields: {},
    warnings: ['COA PDF was stored, but parser could not extract text from it.'],
    error: error?.message ? String(error.message).slice(0, 180) : 'PDF parsing failed.',
    raw: {
      verificationUrls: [],
      snippets: {},
      vialImage: null,
    },
  });
}

export function doesParsedLotMatchBatch(parsedCoa, batchNumber) {
  const parsedLot = normalizeMatchText(parsedCoa?.fields?.lotNumber);
  const targetBatch = normalizeMatchText(batchNumber);

  return !parsedLot || !targetBatch || parsedLot === targetBatch;
}

export function compactParsedCoa(value) {
  const fields = value?.fields && typeof value.fields === 'object' ? value.fields : {};
  const raw = value?.raw && typeof value.raw === 'object' ? value.raw : {};

  return {
    parserVersion,
    extractionMethod: sanitizeText(value?.extractionMethod) || 'native_pdf',
    templateId: sanitizeText(value?.templateId) || 'unknown',
    templateConfidence: normalizeConfidence(value?.templateConfidence),
    matchedAnchors: sanitizeStringList(value?.matchedAnchors, 12, 80),
    pageCount: Math.max(0, Math.round(Number(value?.pageCount) || 0)),
    confidence: normalizeConfidence(value?.confidence),
    fields: compactFields(fields),
    warnings: sanitizeStringList(value?.warnings, 12, 180),
    ...(value?.error ? { error: sanitizeText(value.error).slice(0, 180) } : {}),
    raw: {
      verificationUrls: sanitizeStringList(raw.verificationUrls, 8, 240),
      snippets: compactSnippets(raw.snippets),
      vialImage: compactVialImageMetadata(raw.vialImage),
    },
  };
}

function compactFields(fields) {
  return {
    lab: sanitizeText(fields.lab).slice(0, 120),
    coaNumber: sanitizeText(fields.coaNumber).slice(0, 80),
    lotNumber: sanitizeText(fields.lotNumber).slice(0, 160),
    accessionNumber: sanitizeText(fields.accessionNumber).slice(0, 80),
    productName: sanitizeText(fields.productName).slice(0, 120),
    identityConfirmation: sanitizeText(fields.identityConfirmation).slice(0, 120),
    analysisDate: sanitizeText(fields.analysisDate).slice(0, 40),
    dateReceived: sanitizeText(fields.dateReceived).slice(0, 40),
    issuedDate: sanitizeText(fields.issuedDate).slice(0, 40),
    labeledContent: sanitizeText(fields.labeledContent).slice(0, 40),
    purity: sanitizeText(fields.purity).slice(0, 40),
    averageNetContent: sanitizeText(fields.averageNetContent).slice(0, 40),
    meanPurity: sanitizeText(fields.meanPurity).slice(0, 40),
    heavyMetals: normalizePassFailPending(fields.heavyMetals),
    sterility: normalizePassFailPending(fields.sterility),
    endotoxins: normalizePassFailPending(fields.endotoxins),
    fentanyl: normalizePassFailPending(fields.fentanyl),
    accessCode: sanitizeText(fields.accessCode).slice(0, 80),
    verificationUrl: sanitizeUrl(fields.verificationUrl).slice(0, 240),
    overallStatus: normalizePassFail(fields.overallStatus),
  };
}

function compactSnippets(snippets) {
  if (!snippets || typeof snippets !== 'object' || Array.isArray(snippets)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(snippets)
      .slice(0, 6)
      .map(([key, value]) => [sanitizeText(key).slice(0, 40), sanitizeText(value).slice(0, maxRawSnippetLength)])
      .filter(([key, value]) => key && value),
  );
}

function compactVialImageMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return {
    pageNumber: Math.max(0, Math.round(Number(value.pageNumber) || 0)),
    operatorIndex: Math.max(0, Math.round(Number(value.operatorIndex) || 0)),
    imageName: sanitizeText(value.imageName).slice(0, 80),
    width: Math.max(0, Math.round(Number(value.width) || 0)),
    height: Math.max(0, Math.round(Number(value.height) || 0)),
    drawnX: Math.max(0, Math.round(Number(value.drawnX) * 100) / 100 || 0),
    drawnY: Math.max(0, Math.round(Number(value.drawnY) * 100) / 100 || 0),
    drawnWidth: Math.max(0, Math.round(Number(value.drawnWidth) * 100) / 100 || 0),
    drawnHeight: Math.max(0, Math.round(Number(value.drawnHeight) * 100) / 100 || 0),
    mimeType: sanitizeText(value.mimeType).slice(0, 40) || 'image/png',
    score: Math.max(0, Math.round(Number(value.score) * 100) / 100 || 0),
  };
}

function normalizePassFail(value) {
  const text = sanitizeText(value);

  if (/^pass$/i.test(text)) {
    return 'Pass';
  }

  if (/^fail$/i.test(text)) {
    return 'Fail';
  }

  return '';
}

function normalizePassFailPending(value) {
  const status = normalizePassFail(value);

  return status || (sanitizeText(value) === 'Pending' ? 'Pending' : 'Pending');
}

function normalizeConfidence(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Math.round(number * 1000) / 1000));
}

function sanitizeStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => sanitizeText(item).slice(0, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function sanitizeUrl(value) {
  return sanitizeText(value).replace(/[),.;]+$/g, '');
}

function normalizeMatchText(value) {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
