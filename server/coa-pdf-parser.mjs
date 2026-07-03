import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PNG } from 'pngjs';

const parserVersion = 'coa-pdf-parser-v1';
const maxRawSnippetLength = 1200;

export async function parseCoaPdfBuffer(buffer, options = {}) {
  return (await parseCoaPdfUploadBuffer(buffer, options)).parsedCoa;
}

export async function parseCoaPdfUploadBuffer(buffer, options = {}) {
  const data = new Uint8Array(buffer);
  const document = await pdfjs.getDocument({
    data,
    disableWorker: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
  const pages = [];
  const annotationUrls = [];
  const imageCandidates = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = createPageLines(textContent.items);
    const annotations = await page.getAnnotations();

    for (const annotation of annotations) {
      const url = sanitizeUrl(annotation?.url || annotation?.unsafeUrl);

      if (url) {
        annotationUrls.push(url);
      }
    }

    pages.push({
      pageNumber,
      lines,
      text: lines.join('\n'),
    });

    if (pageNumber === 1) {
      imageCandidates.push(...await extractPageImageCandidates(page, pageNumber));
    }
  }

  const fullText = pages.map((page) => page.text).join('\n');
  const textUrls = extractVerificationUrls(fullText);
  const verificationUrl = [...annotationUrls, ...textUrls].find(isLikelyVerificationUrl) || textUrls[0] || '';
  const template = detectTemplate(fullText);
  const fields = template.templateId === 'ils_laboratories_coa'
    ? parseIlsFields(pages, fullText, verificationUrl)
    : parseGenericFields(pages, fullText, verificationUrl);
  const warnings = validateParsedFields(fields, { fileName: options.fileName });
  const confidence = calculateConfidence(fields, template, warnings);
  const vialImage = selectVialImageCandidate(imageCandidates);

  return {
    parsedCoa: compactParsedCoa({
      parserVersion,
      extractionMethod: 'native_pdf',
      templateId: template.templateId,
      templateConfidence: template.confidence,
      matchedAnchors: template.matchedAnchors,
      pageCount: document.numPages,
      confidence,
      fields,
      warnings,
      raw: {
        verificationUrls: [...new Set([...annotationUrls, ...textUrls])],
        snippets: createSnippets(pages),
        vialImage: vialImage ? createVialImageMetadata(vialImage) : null,
      },
    }),
    vialImage: vialImage ? {
      buffer: vialImage.buffer,
      mimeType: 'image/png',
      width: vialImage.width,
      height: vialImage.height,
      sourceName: vialImage.name,
      pageNumber: vialImage.pageNumber,
      operatorIndex: vialImage.operatorIndex,
    } : null,
  };
}

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

async function extractPageImageCandidates(page, pageNumber) {
  const operatorList = await page.getOperatorList();
  const candidates = [];
  const pageWidth = Math.abs(Number(page.view?.[2]) - Number(page.view?.[0])) || 612;
  let currentMatrix = [1, 0, 0, 1, 0, 0];
  const matrixStack = [];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operator = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];

    if (operator === pdfjs.OPS.save) {
      matrixStack.push(currentMatrix.slice());
      continue;
    }

    if (operator === pdfjs.OPS.restore) {
      currentMatrix = matrixStack.pop() || [1, 0, 0, 1, 0, 0];
      continue;
    }

    if (operator === pdfjs.OPS.transform) {
      currentMatrix = multiplyPdfMatrix(currentMatrix, args);
      continue;
    }

    if (operator !== pdfjs.OPS.paintImageXObject) {
      continue;
    }

    const [name, width, height] = args ?? [];
    const placement = createImagePlacement(currentMatrix, pageWidth);

    if (!name || !isSaneVialImageSize(width, height, placement)) {
      continue;
    }

    const image = await getPageImageObject(page, name);
    const candidate = createImageCandidate({ image, name, pageNumber, operatorIndex: index, placement });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function multiplyPdfMatrix(first, second) {
  if (!Array.isArray(second) || second.length < 6) {
    return first;
  }

  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function createImagePlacement(matrix, pageWidth) {
  return {
    x: Number(matrix?.[4]) || 0,
    y: Number(matrix?.[5]) || 0,
    width: Math.abs(Number(matrix?.[0]) || 0),
    height: Math.abs(Number(matrix?.[3]) || 0),
    pageWidth,
  };
}

function getPageImageObject(page, name) {
  return new Promise((resolve) => {
    page.objs.get(name, resolve);
  });
}

function createImageCandidate({ image, name, pageNumber, operatorIndex, placement }) {
  const width = Math.max(0, Math.round(Number(image?.width) || 0));
  const height = Math.max(0, Math.round(Number(image?.height) || 0));

  if (!isSaneVialImageSize(width, height, placement) || !image?.data) {
    return null;
  }

  const rgba = toRgbaBuffer(image);
  const content = analyzeImageContent(rgba, width, height);

  if (content.visibleRatio < 0.02 || content.nonWhiteRatio < 0.01) {
    return null;
  }

  const score = scoreVialImageCandidate({ width, height, kind: image.kind, operatorIndex, content, placement });
  const png = new PNG({ width, height });
  png.data = rgba;

  return {
    name,
    pageNumber,
    operatorIndex,
    width,
    height,
    kind: image.kind,
    placement,
    score,
    content,
    buffer: PNG.sync.write(png),
  };
}

function isSaneVialImageSize(width, height, placement = {}) {
  const cleanWidth = Number(width);
  const cleanHeight = Number(height);
  const aspectRatio = cleanWidth / cleanHeight;
  const drawWidth = Number(placement.width) || 0;
  const drawHeight = Number(placement.height) || 0;

  return Number.isFinite(cleanWidth)
    && Number.isFinite(cleanHeight)
    && cleanWidth >= 120
    && cleanWidth <= 900
    && cleanHeight >= 120
    && cleanHeight <= 900
    && aspectRatio >= 0.45
    && aspectRatio <= 1.35
    && (!drawWidth || (drawWidth >= 45 && drawWidth <= 170))
    && (!drawHeight || (drawHeight >= 45 && drawHeight <= 180));
}

function toRgbaBuffer(image) {
  const width = Math.max(0, Math.round(Number(image.width) || 0));
  const height = Math.max(0, Math.round(Number(image.height) || 0));
  const pixelCount = width * height;
  const source = image.data;
  const rgba = Buffer.alloc(pixelCount * 4);

  if (image.kind === pdfjs.ImageKind.RGBA_32BPP) {
    return Buffer.from(source);
  }

  if (image.kind === pdfjs.ImageKind.RGB_24BPP) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      rgba[pixel * 4] = source[pixel * 3] ?? 0;
      rgba[pixel * 4 + 1] = source[pixel * 3 + 1] ?? 0;
      rgba[pixel * 4 + 2] = source[pixel * 3 + 2] ?? 0;
      rgba[pixel * 4 + 3] = 255;
    }

    return rgba;
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const value = source[pixel] ?? 0;
    rgba[pixel * 4] = value;
    rgba[pixel * 4 + 1] = value;
    rgba[pixel * 4 + 2] = value;
    rgba[pixel * 4 + 3] = 255;
  }

  return rgba;
}

function analyzeImageContent(rgba, width, height) {
  const pixelCount = Math.max(1, width * height);
  let visiblePixels = 0;
  let nonWhitePixels = 0;

  for (let offset = 0; offset < rgba.length; offset += 4) {
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const alpha = rgba[offset + 3];

    if (alpha <= 10) {
      continue;
    }

    visiblePixels += 1;

    if (red < 245 || green < 245 || blue < 245) {
      nonWhitePixels += 1;
    }
  }

  return {
    visibleRatio: visiblePixels / pixelCount,
    nonWhiteRatio: nonWhitePixels / pixelCount,
  };
}

function scoreVialImageCandidate({ width, height, kind, operatorIndex, content, placement }) {
  let score = 0;
  const aspectRatio = width / height;
  const isRightSide = placement.x >= placement.pageWidth * 0.72;

  if (isRightSide) {
    score += 8;
  }

  if (placement.y >= 480 && placement.y <= 640) {
    score += 4;
  }

  if (placement.width >= 60 && placement.width <= 120 && placement.height >= 60 && placement.height <= 130) {
    score += 4;
  }

  if (width >= 500 && height >= 500) {
    score += 3;
  }

  if (aspectRatio >= 0.65 && aspectRatio <= 1.05) {
    score += 2;
  }

  if (operatorIndex >= 280 && operatorIndex <= 380) {
    score += 2;
  }

  if (kind === pdfjs.ImageKind.RGBA_32BPP && !isRightSide) {
    score -= 4;
  }

  score += Math.min(2, content.nonWhiteRatio * 8);

  return Math.round(score * 100) / 100;
}

function selectVialImageCandidate(candidates) {
  return candidates
    .slice()
    .sort((first, second) =>
    second.score - first.score ||
      second.placement.x - first.placement.x ||
      first.operatorIndex - second.operatorIndex,
    )[0] ?? null;
}

function createVialImageMetadata(vialImage) {
  return {
    pageNumber: vialImage.pageNumber,
    operatorIndex: vialImage.operatorIndex,
    imageName: vialImage.name,
    width: vialImage.width,
    height: vialImage.height,
    drawnX: Math.round(vialImage.placement.x * 100) / 100,
    drawnY: Math.round(vialImage.placement.y * 100) / 100,
    drawnWidth: Math.round(vialImage.placement.width * 100) / 100,
    drawnHeight: Math.round(vialImage.placement.height * 100) / 100,
    mimeType: 'image/png',
    score: vialImage.score,
  };
}

function createPageLines(items) {
  return items
    .map((item) => sanitizeText(item?.str))
    .filter(Boolean);
}

function detectTemplate(fullText) {
  const anchors = [
    'ILS Laboratories',
    'Certificate of Analysis',
    'Purity & Quant',
    'Sterility',
    'Endotoxin',
    'Heavy Metals',
  ];
  const matchedAnchors = anchors.filter((anchor) => fullText.includes(anchor));
  const confidence = matchedAnchors.length / anchors.length;

  return {
    templateId: confidence >= 0.5 ? 'ils_laboratories_coa' : 'generic_coa',
    confidence,
    matchedAnchors,
  };
}

function parseIlsFields(pages, fullText, verificationUrl) {
  const lines = pages.flatMap((page) => page.lines);
  const issuedDate = normalizeDate(readValueAfterLabel(lines, ['Issued']));
  const productLabel = lines.find((line) => /\s-\s*\d+(?:\.\d+)?\s*mg\b/i.test(line)) || '';
  const productMatch = productLabel.match(/^(.+?)\s*-\s*([0-9.]+\s*mg)\b/i);
  const conformity = parseConformityMean(lines);

  return compactFields({
    lab: fullText.includes('ILS Laboratories') ? 'ILS Laboratories' : '',
    coaNumber: readValueAfterLabel(lines, ['COA #']) || readInlineMatch(fullText, /\bCOA:\s*([A-Z0-9-]+)/i),
    lotNumber: readValueAfterLabel(lines, ['Lot Number']) || readInlineMatch(fullText, /\bLot:\s*([A-Z0-9-]+)/i),
    accessionNumber: readValueAfterLabel(lines, ['Accession #']),
    productName: productMatch?.[1] || readValueAfterLabel(lines, ['Identity']),
    analysisDate: normalizeDate(readValueAfterLabel(lines, ['Analysis Date']) || readInlineMatch(fullText, /Date Tested:\s*([0-9/.-]+)/i)),
    dateReceived: normalizeDate(readValueAfterLabel(lines, ['Date Received'])),
    issuedDate,
    labeledContent: normalizeMass(readValueAfterLabel(lines, ['Labeled Content']) || productMatch?.[2]),
    purity: normalizePercent(findValueAfterLine(lines, /^Peptide Purity$/i, /^[0-9.]+\s*%$/)),
    averageNetContent: conformity.meanContent || normalizeMass(findTableResult(lines, 'Net Peptide Content', 'mg')),
    meanPurity: conformity.meanPurity,
    heavyMetals: parseSectionStatus(lines, /Heavy Metals/i, /Sterility Testing|Endotoxin Testing|Notes & Methodology|COA #/i),
    sterility: parseSectionStatus(lines, /Sterility Testing/i, /Endotoxin Testing|Notes & Methodology|COA #/i),
    endotoxins: parseSectionStatus(lines, /Endotoxin Testing/i, /Acceptance criteria|Notes & Methodology|COA #/i),
    fentanyl: parseFentanylStatus(lines),
    accessCode: readValueAfterLabel(lines, ['Access Code']),
    verificationUrl: verificationUrl ? ensureHttpsUrl(verificationUrl) : '',
    overallStatus: normalizePassFail(lines.find((line) => /^(PASS|FAIL)$/i.test(line))),
  });
}

function parseGenericFields(pages, fullText, verificationUrl) {
  const lines = pages.flatMap((page) => page.lines);

  return compactFields({
    lab: readLikelyLab(lines),
    coaNumber: readValueAfterLabel(lines, ['COA #', 'COA Number', 'Certificate Number']),
    lotNumber: readValueAfterLabel(lines, ['Lot Number', 'Batch Number', 'Batch', 'Lot']),
    accessionNumber: readValueAfterLabel(lines, ['Accession #', 'Accession Number']),
    analysisDate: normalizeDate(readValueAfterLabel(lines, ['Analysis Date', 'Date Tested', 'Test Date'])),
    dateReceived: normalizeDate(readValueAfterLabel(lines, ['Date Received', 'Received Date'])),
    issuedDate: normalizeDate(readValueAfterLabel(lines, ['Issued', 'Issue Date', 'Issued Date'])),
    labeledContent: normalizeMass(readValueAfterLabel(lines, ['Labeled Content', 'Label Claim'])),
    purity: normalizePercent(findFirstMatch(fullText, /([0-9]{1,3}(?:\.[0-9]+)?)\s*%\s*(?:purity|pure)?/i)),
    averageNetContent: normalizeMass(findFirstMatch(fullText, /\b(?:mean|average)[^\n]*?([0-9]+(?:\.[0-9]+)?\s*mg)\b/i)),
    heavyMetals: parseKeywordStatus(fullText, /heavy metals?/i),
    sterility: parseKeywordStatus(fullText, /sterility|sterile/i),
    endotoxins: parseKeywordStatus(fullText, /endotoxin/i),
    fentanyl: parseKeywordStatus(fullText, /fentanyl/i),
    verificationUrl: verificationUrl ? ensureHttpsUrl(verificationUrl) : '',
    overallStatus: normalizePassFail(findFirstMatch(fullText, /\b(PASS|FAIL)\b/i)),
  });
}

function readValueAfterLabel(lines, labels) {
  const normalizedLabels = labels.map(normalizeLabel);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineLabel = normalizeLabel(line.replace(/:$/, ''));
    const labelIndex = normalizedLabels.findIndex((label) => lineLabel === label);

    if (labelIndex === -1) {
      const inline = labels
        .map((label) => line.match(new RegExp(`^${escapeRegExp(label)}\\s*:?\\s*(.+)$`, 'i'))?.[1])
        .find(Boolean);

      if (inline) {
        return sanitizeText(inline);
      }

      continue;
    }

    for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 5); nextIndex += 1) {
      const value = sanitizeText(lines[nextIndex]);

      if (value && normalizeLabel(value) !== lineLabel) {
        return value;
      }
    }
  }

  return '';
}

function findValueAfterLine(lines, labelPattern, valuePattern) {
  const index = lines.findIndex((line) => labelPattern.test(line));

  if (index === -1) {
    return '';
  }

  for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 12); nextIndex += 1) {
    const value = sanitizeText(lines[nextIndex]);

    if (valuePattern.test(value)) {
      return value;
    }
  }

  return '';
}

function findTableResult(lines, rowLabel, unit) {
  const index = lines.findIndex((line) => normalizeLabel(line) === normalizeLabel(rowLabel));

  if (index === -1) {
    return '';
  }

  for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 12); nextIndex += 1) {
    const value = sanitizeText(lines[nextIndex]);

    if (unit === 'mg' && /^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
      return `${value} mg`;
    }

    if (unit === 'mg' && /^[0-9]+(?:\.[0-9]+)?\s*mg$/i.test(value)) {
      return value;
    }
  }

  return '';
}

function parseConformityMean(lines) {
  const meanIndex = lines.findIndex((line) => /^Mean$/i.test(line));

  if (meanIndex === -1) {
    return {};
  }

  const values = lines.slice(meanIndex + 1, meanIndex + 8);

  return {
    meanPurity: normalizePercent(values.find((value) => /^[0-9.]+\s*%$/.test(value))),
    meanContent: normalizeMass(values.find((value) => /^[0-9.]+\s*mg$/i.test(value))),
  };
}

function parseSectionStatus(lines, startPattern, endPattern) {
  const startIndex = lines.findIndex((line) => startPattern.test(line));

  if (startIndex === -1) {
    return 'Pending';
  }

  const endIndex = lines.findIndex((line, index) => index > startIndex && endPattern.test(line));
  const section = lines.slice(startIndex, endIndex === -1 ? Math.min(lines.length, startIndex + 80) : endIndex).join('\n');

  return parseKeywordStatus(section);
}

function parseFentanylStatus(lines) {
  const index = lines.findIndex((line) => /Fentanyl Screen|^Fentanyl$/i.test(line));

  if (index === -1) {
    return 'Pending';
  }

  const section = lines.slice(index, Math.min(lines.length, index + 18)).join('\n');

  if (/\bFree\b/i.test(section) || /Not\s+Detected/i.test(section)) {
    return /\bFAIL\b/i.test(section) ? 'Fail' : 'Pass';
  }

  return parseKeywordStatus(section);
}

function parseKeywordStatus(text, requiredPattern = null) {
  if (requiredPattern && !requiredPattern.test(text)) {
    return 'Pending';
  }

  if (/\bFAIL(?:ED)?\b|Detected|Growth\s+Detected|Positive/i.test(text) && !/Not\s+Detected/i.test(text)) {
    return 'Fail';
  }

  if (/\bPASS(?:ED)?\b|Not\s+Detected|No\s+Growth|\bFree\b/i.test(text)) {
    return 'Pass';
  }

  return 'Pending';
}

function validateParsedFields(fields) {
  const warnings = [];

  if (!fields.lotNumber) {
    warnings.push('Lot or batch number was not found.');
  }

  if (!fields.analysisDate) {
    warnings.push('Analysis date was not found.');
  }

  if (fields.purity) {
    const purityValue = Number(String(fields.purity).replace('%', ''));

    if (!Number.isFinite(purityValue) || purityValue < 0 || purityValue > 100) {
      warnings.push('Purity value is outside the expected 0-100% range.');
    }
  }

  if (!fields.verificationUrl) {
    warnings.push('Verification URL was not found.');
  }

  return warnings;
}

function calculateConfidence(fields, template, warnings) {
  const importantFields = [
    'lab',
    'coaNumber',
    'lotNumber',
    'analysisDate',
    'purity',
    'averageNetContent',
    'verificationUrl',
  ];
  const fieldScore = importantFields.filter((field) => fields[field]).length / importantFields.length;
  const warningPenalty = Math.min(0.3, warnings.length * 0.05);

  return normalizeConfidence((fieldScore * 0.65) + (template.confidence * 0.35) - warningPenalty);
}

function createSnippets(pages) {
  const snippets = {};
  const firstPage = pages[0]?.text || '';
  const safetyPage = pages.find((page) => /Heavy Metals|Sterility|Endotoxin/i.test(page.text))?.text || '';

  if (firstPage) {
    snippets.summary = firstPage.slice(0, maxRawSnippetLength);
  }

  if (safetyPage) {
    snippets.safety = safetyPage.slice(0, maxRawSnippetLength);
  }

  return snippets;
}

function compactFields(fields) {
  return {
    lab: sanitizeText(fields.lab).slice(0, 120),
    coaNumber: sanitizeText(fields.coaNumber).slice(0, 80),
    lotNumber: sanitizeText(fields.lotNumber).slice(0, 160),
    accessionNumber: sanitizeText(fields.accessionNumber).slice(0, 80),
    productName: sanitizeText(fields.productName).slice(0, 120),
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

function normalizeDate(value) {
  const text = sanitizeText(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/) || text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!match) {
    return '';
  }

  if (match[1].length === 4) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function normalizeMass(value) {
  const text = sanitizeText(value);
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(mg)\b/i);

  return match ? `${match[1]} mg` : '';
}

function normalizePercent(value) {
  const text = sanitizeText(value);
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);

  return match ? `${match[1]}%` : '';
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

function extractVerificationUrls(text) {
  const matches = text.match(/(?:https?:\/\/)?[a-z0-9.-]+\/verify\/[A-Za-z0-9_-]+/gi) || [];

  return matches.map((url) => sanitizeUrl(url)).filter(Boolean);
}

function isLikelyVerificationUrl(url) {
  return /\/verify\/[A-Za-z0-9_-]+/i.test(url);
}

function ensureHttpsUrl(url) {
  const cleanUrl = sanitizeUrl(url);

  return /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
}

function sanitizeUrl(value) {
  return sanitizeText(value).replace(/[),.;]+$/g, '');
}

function readInlineMatch(text, pattern) {
  return sanitizeText(text.match(pattern)?.[1]);
}

function findFirstMatch(text, pattern) {
  return sanitizeText(text.match(pattern)?.[1]);
}

function readLikelyLab(lines) {
  return sanitizeText(lines.find((line) => /Lab|Laborator/i.test(line))).slice(0, 120);
}

function sanitizeStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => sanitizeText(item).slice(0, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeLabel(value) {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeMatchText(value) {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
