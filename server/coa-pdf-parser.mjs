import { PNG } from 'pngjs';
import { compactParsedCoa, createFailedParsedCoa, doesParsedLotMatchBatch } from './coa-pdf-normalizer.mjs';

const parserVersion = 'coa-pdf-parser-v2';
const defaultEndotoxinPassThresholdEuMl = 5;
const maxRawSnippetLength = 1200;
let pdfjsModulePromise;
let pdfjsWorkerModulePromise;

export { compactParsedCoa, createFailedParsedCoa, doesParsedLotMatchBatch };

export async function parseCoaPdfBuffer(buffer, options = {}) {
  return (await parseCoaPdfUploadBuffer(buffer, options)).parsedCoa;
}

export async function identifyCoaPdfBatchNumber(buffer) {
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
  const firstPage = await document.getPage(1);
  const textContent = await firstPage.getTextContent();

  return findCoaBatchNumber(createPageLines(textContent.items));
}

export function findCoaBatchNumber(lines) {
  const fullText = lines.map(sanitizeText).filter(Boolean).join('\n');

  return sanitizeText(
    readValueAfterLabel(lines, ['Lot Number', 'Batch Number', 'Batch #', 'Batch', 'Lot']) ||
      readInlineMatch(fullText, /\b(?:Lot|Batch)(?:\s+Number|\s*#)?\s*:\s*([A-Z0-9][A-Z0-9._/-]*)/i),
  ).slice(0, 160);
}

export async function parseCoaPdfUploadBuffer(buffer, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  let pdfjs;

  try {
    pdfjs = await loadPdfJs();
  } catch (error) {
    log('parser-runtime-load-failed', {
      fileName: options.fileName,
      error: serializeErrorForDiagnostics(error),
    }, 'error');
    throw error;
  }

  const imageExtractor = options.imageExtractor || ((page, pageNumber) => extractPageImageCandidates(pdfjs, page, pageNumber));
  const data = new Uint8Array(buffer);
  const pdfOptions = {
    data,
    disableWorker: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  };

  log('parser-document-open-start', {
    fileName: options.fileName,
    byteLength: buffer.length,
    pdfjsVersion: pdfjs.version,
    hasDOMMatrix: typeof globalThis.DOMMatrix !== 'undefined',
    hasImageData: typeof globalThis.ImageData !== 'undefined',
    hasPath2D: typeof globalThis.Path2D !== 'undefined',
    hasPdfJsWorker: Boolean(globalThis.pdfjsWorker?.WorkerMessageHandler),
    workerSrc: pdfjs.GlobalWorkerOptions?.workerSrc || '',
  });

  let document;

  try {
    document = await pdfjs.getDocument(pdfOptions).promise;
  } catch (error) {
    log('parser-document-open-failed', {
      fileName: options.fileName,
      error: serializeErrorForDiagnostics(error),
    }, 'error');
    throw error;
  }

  log('parser-document-open-complete', {
    fileName: options.fileName,
    pageCount: document.numPages,
    fingerprints: Array.isArray(document.fingerprints) ? document.fingerprints : [],
  });

  const pages = [];
  const annotationUrls = [];
  const imageCandidates = [];
  const parserWarnings = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    log('parser-page-start', {
      fileName: options.fileName,
      pageNumber,
    });

    let page;
    let textContent;

    try {
      page = await document.getPage(pageNumber);
    } catch (error) {
      log('parser-page-open-failed', {
        fileName: options.fileName,
        pageNumber,
        error: serializeErrorForDiagnostics(error),
      }, 'error');
      throw error;
    }

    try {
      textContent = await page.getTextContent();
    } catch (error) {
      log('parser-page-text-failed', {
        fileName: options.fileName,
        pageNumber,
        error: serializeErrorForDiagnostics(error),
      }, 'error');
      throw error;
    }

    const lines = createPageLines(textContent.items);
    log('parser-page-text-complete', {
      fileName: options.fileName,
      pageNumber,
      textItemCount: Array.isArray(textContent.items) ? textContent.items.length : 0,
      lineCount: lines.length,
      textLength: lines.join('\n').length,
      firstLines: lines.slice(0, 5),
    });

    const annotations = await readPageAnnotations(page, {
      fileName: options.fileName,
      log,
      pageNumber,
      parserWarnings,
    });

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
      imageCandidates.push(...await readPageImageCandidates(page, {
        fileName: options.fileName,
        imageExtractor,
        log,
        pageNumber,
        parserWarnings,
      }));
    }
  }

  const fullText = pages.map((page) => page.text).join('\n');
  log('parser-text-assembled', {
    fileName: options.fileName,
    pageCount: pages.length,
    totalTextLength: fullText.length,
    pageLineCounts: pages.map((page) => ({
      pageNumber: page.pageNumber,
      lineCount: page.lines.length,
      textLength: page.text.length,
    })),
  }, fullText.length > 0 ? 'log' : 'warn');

  const textUrls = extractVerificationUrls(fullText);
  const verificationUrl = [...annotationUrls, ...textUrls].find(isLikelyVerificationUrl) || textUrls[0] || '';
  const template = detectTemplate(fullText);
  const thresholdInput = Object.prototype.hasOwnProperty.call(options, 'endotoxinThresholdEuMl')
    ? options.endotoxinThresholdEuMl
    : process.env.HELIX_ENDOTOXIN_PASS_THRESHOLD_EU_ML;
  const endotoxinThreshold = resolveEndotoxinThreshold(thresholdInput);
  const fieldWarnings = [];
  const fields = template.templateId === 'ils_laboratories_coa'
    ? parseIlsFields(pages, fullText, verificationUrl, { endotoxinThreshold, warnings: fieldWarnings })
    : parseGenericFields(pages, fullText, verificationUrl, { endotoxinThreshold, warnings: fieldWarnings });
  const warnings = [
    ...validateParsedFields(fields, { fileName: options.fileName }),
    ...fieldWarnings,
    ...parserWarnings,
  ];
  const confidence = calculateConfidence(fields, template, warnings);
  const vialImage = selectVialImageCandidate(imageCandidates);
  const parsedSummary = {
    fileName: options.fileName,
    template,
    confidence,
    warnings,
    fieldPresence: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, Boolean(String(value ?? '').trim())]),
    ),
    annotationUrlCount: annotationUrls.length,
    textUrlCount: textUrls.length,
    imageCandidateCount: imageCandidates.length,
    selectedVialImage: vialImage
      ? {
          name: vialImage.name,
          pageNumber: vialImage.pageNumber,
          operatorIndex: vialImage.operatorIndex,
          width: vialImage.width,
          height: vialImage.height,
          score: vialImage.score,
        }
      : null,
  };

  log('parser-fields-complete', parsedSummary, warnings.length > 0 ? 'warn' : 'log');

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

async function loadPdfJs() {
  installPdfJsNodePolyfills();
  pdfjsWorkerModulePromise ??= import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjsModulePromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  installPdfJsWorkerHandler(await pdfjsWorkerModulePromise);

  return pdfjsModulePromise;
}

function installPdfJsWorkerHandler(workerModule) {
  const workerHandler = workerModule?.WorkerMessageHandler;

  if (!workerHandler) {
    throw new Error('pdf.js worker module did not export WorkerMessageHandler.');
  }

  const existingWorker = globalThis.pdfjsWorker && typeof globalThis.pdfjsWorker === 'object'
    ? globalThis.pdfjsWorker
    : {};
  globalThis.pdfjsWorker = {
    ...existingWorker,
    WorkerMessageHandler: workerHandler,
  };
}

function installPdfJsNodePolyfills() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = HelixDOMMatrix;
  }

  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = HelixPath2D;
  }

  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = HelixImageData;
  }
}

class HelixDOMMatrix {
  constructor(init) {
    const values = Array.isArray(init) || ArrayBuffer.isView(init)
      ? Array.from(init)
      : typeof init === 'object' && init
        ? [
            init.a ?? init.m11,
            init.b ?? init.m12,
            init.c ?? init.m21,
            init.d ?? init.m22,
            init.e ?? init.m41,
            init.f ?? init.m42,
          ]
        : [];
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;

    this.a = Number(a) || 0;
    this.b = Number(b) || 0;
    this.c = Number(c) || 0;
    this.d = Number(d) || 0;
    this.e = Number(e) || 0;
    this.f = Number(f) || 0;
  }

  get m11() { return this.a; }
  set m11(value) { this.a = Number(value) || 0; }
  get m12() { return this.b; }
  set m12(value) { this.b = Number(value) || 0; }
  get m21() { return this.c; }
  set m21(value) { this.c = Number(value) || 0; }
  get m22() { return this.d; }
  set m22(value) { this.d = Number(value) || 0; }
  get m41() { return this.e; }
  set m41(value) { this.e = Number(value) || 0; }
  get m42() { return this.f; }
  set m42(value) { this.f = Number(value) || 0; }
  get is2D() { return true; }
  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  multiply(other) {
    return new HelixDOMMatrix(this.toFloat64Array()).multiplySelf(other);
  }

  multiplySelf(other) {
    const matrix = new HelixDOMMatrix(other);
    const a = this.a * matrix.a + this.c * matrix.b;
    const b = this.b * matrix.a + this.d * matrix.b;
    const c = this.a * matrix.c + this.c * matrix.d;
    const d = this.b * matrix.c + this.d * matrix.d;
    const e = this.a * matrix.e + this.c * matrix.f + this.e;
    const f = this.b * matrix.e + this.d * matrix.f + this.f;

    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  preMultiplySelf(other) {
    const matrix = new HelixDOMMatrix(other);
    const next = matrix.multiply(this);

    this.a = next.a;
    this.b = next.b;
    this.c = next.c;
    this.d = next.d;
    this.e = next.e;
    this.f = next.f;
    return this;
  }

  translate(x = 0, y = 0) {
    return new HelixDOMMatrix(this.toFloat64Array()).translateSelf(x, y);
  }

  translateSelf(x = 0, y = 0) {
    return this.multiplySelf([1, 0, 0, 1, Number(x) || 0, Number(y) || 0]);
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return new HelixDOMMatrix(this.toFloat64Array()).scaleSelf(scaleX, scaleY);
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    return this.multiplySelf([Number(scaleX) || 0, 0, 0, Number(scaleY) || 0, 0, 0]);
  }

  inverse() {
    return new HelixDOMMatrix(this.toFloat64Array()).invertSelf();
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;

    if (!determinant) {
      this.a = Number.NaN;
      this.b = Number.NaN;
      this.c = Number.NaN;
      this.d = Number.NaN;
      this.e = Number.NaN;
      this.f = Number.NaN;
      return this;
    }

    const a = this.d / determinant;
    const b = -this.b / determinant;
    const c = -this.c / determinant;
    const d = this.a / determinant;
    const e = (this.c * this.f - this.d * this.e) / determinant;
    const f = (this.b * this.e - this.a * this.f) / determinant;

    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  toFloat32Array() {
    return Float32Array.from(this.toFloat64Array());
  }

  toFloat64Array() {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }
}

class HelixPath2D {
  addPath() {}
  arc() {}
  arcTo() {}
  bezierCurveTo() {}
  closePath() {}
  ellipse() {}
  lineTo() {}
  moveTo() {}
  quadraticCurveTo() {}
  rect() {}
  roundRect() {}
}

class HelixImageData {
  constructor(dataOrWidth, widthOrHeight, heightOrSettings, settings = {}) {
    if (typeof dataOrWidth === 'number') {
      this.width = Math.max(0, Math.round(dataOrWidth));
      this.height = Math.max(0, Math.round(Number(widthOrHeight) || 0));
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      this.colorSpace = heightOrSettings?.colorSpace || 'srgb';
      return;
    }

    this.data = dataOrWidth;
    this.width = Math.max(0, Math.round(Number(widthOrHeight) || 0));
    this.height = Math.max(0, Math.round(Number(heightOrSettings) || 0));
    this.colorSpace = settings?.colorSpace || 'srgb';
  }
}

async function readPageAnnotations(page, { fileName, log, pageNumber, parserWarnings }) {
  try {
    const annotations = await page.getAnnotations();

    log('parser-page-annotations-complete', {
      fileName,
      pageNumber,
      annotationCount: Array.isArray(annotations) ? annotations.length : 0,
    });

    return annotations;
  } catch (error) {
    parserWarnings.push('PDF annotations could not be read.');
    log('parser-page-annotations-failed', {
      fileName,
      pageNumber,
      error: serializeErrorForDiagnostics(error),
    }, 'warn');
    return [];
  }
}

async function readPageImageCandidates(page, { fileName, imageExtractor, log, pageNumber, parserWarnings }) {
  try {
    log('parser-page-image-start', {
      fileName,
      pageNumber,
    });

    const candidates = await imageExtractor(page, pageNumber);

    log('parser-page-image-complete', {
      fileName,
      pageNumber,
      candidateCount: candidates.length,
      candidates: candidates.map((candidate) => ({
        name: candidate.name,
        operatorIndex: candidate.operatorIndex,
        width: candidate.width,
        height: candidate.height,
        score: candidate.score,
      })),
    });

    return candidates;
  } catch (error) {
    parserWarnings.push('COA vial image could not be extracted.');
    log('parser-page-image-failed', {
      fileName,
      pageNumber,
      error: serializeErrorForDiagnostics(error),
    }, 'warn');
    return [];
  }
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

async function extractPageImageCandidates(pdfjs, page, pageNumber) {
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
    const candidate = createImageCandidate({ pdfjs, image, name, pageNumber, operatorIndex: index, placement });

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

function createImageCandidate({ pdfjs, image, name, pageNumber, operatorIndex, placement }) {
  const width = Math.max(0, Math.round(Number(image?.width) || 0));
  const height = Math.max(0, Math.round(Number(image?.height) || 0));

  if (!isSaneVialImageSize(width, height, placement) || !image?.data) {
    return null;
  }

  const rgba = toRgbaBuffer(pdfjs, image);
  const content = analyzeImageContent(rgba, width, height);

  if (content.visibleRatio < 0.02 || content.nonWhiteRatio < 0.01) {
    return null;
  }

  const score = scoreVialImageCandidate({ pdfjs, width, height, kind: image.kind, operatorIndex, content, placement });
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

function toRgbaBuffer(pdfjs, image) {
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

function scoreVialImageCandidate({ pdfjs, width, height, kind, operatorIndex, content, placement }) {
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

function parseIlsFields(pages, fullText, verificationUrl, { endotoxinThreshold, warnings }) {
  const lines = pages.flatMap((page) => page.lines);
  const issuedDate = normalizeDate(readValueAfterLabel(lines, ['Issued']));
  const productLabel = lines.find((line) => /\s-\s*\d+(?:\.\d+)?\s*mg\b/i.test(line)) || '';
  const productMatch = productLabel.match(/^(.+?)\s*-\s*([0-9.]+\s*mg)\b/i);
  const identityConfirmation = readValueAfterLabel(lines, ['Identity Confirmation', 'Identity']) || productMatch?.[1] || '';
  const conformity = parseConformityMean(lines);
  const endotoxin = parseEndotoxinAssessment(lines, endotoxinThreshold);

  if (endotoxin.warning) {
    warnings.push(endotoxin.warning);
  }

  return compactFields({
    lab: fullText.includes('ILS Laboratories') ? 'ILS Laboratories' : '',
    coaNumber: readValueAfterLabel(lines, ['COA #']) || readInlineMatch(fullText, /\bCOA:\s*([A-Z0-9-]+)/i),
    lotNumber: readValueAfterLabel(lines, ['Lot Number']) || readInlineMatch(fullText, /\bLot:\s*([A-Z0-9-]+)/i),
    accessionNumber: readValueAfterLabel(lines, ['Accession #']),
    productName: productMatch?.[1] || identityConfirmation,
    identityConfirmation,
    analysisDate: normalizeDate(readValueAfterLabel(lines, ['Analysis Date']) || readInlineMatch(fullText, /Date Tested:\s*([0-9/.-]+)/i)),
    dateReceived: normalizeDate(readValueAfterLabel(lines, ['Date Received'])),
    issuedDate,
    labeledContent: normalizeMass(readValueAfterLabel(lines, ['Labeled Content']) || productMatch?.[2]),
    purity: normalizePercent(findValueAfterLine(lines, /^Peptide Purity$/i, /^[0-9.]+\s*%$/)),
    averageNetContent: conformity.meanContent || parseNetPeptideContent(lines),
    meanPurity: conformity.meanPurity,
    heavyMetals: parseSectionStatus(lines, /Heavy Metals/i, /Sterility Testing|Endotoxin Testing|Notes & Methodology|COA #/i),
    sterility: parseSectionStatus(lines, /Sterility Testing/i, /Endotoxin Testing|Notes & Methodology|COA #/i),
    endotoxinResult: endotoxin.result,
    endotoxinThreshold: endotoxin.threshold,
    endotoxins: endotoxin.status,
    fentanyl: parseFentanylStatus(lines),
    accessCode: readValueAfterLabel(lines, ['Access Code']),
    verificationUrl: verificationUrl ? ensureHttpsUrl(verificationUrl) : '',
    overallStatus: normalizePassFail(lines.find((line) => /^(PASS|FAIL)$/i.test(line))),
  });
}

function parseGenericFields(pages, fullText, verificationUrl, { endotoxinThreshold, warnings }) {
  const lines = pages.flatMap((page) => page.lines);
  const identityConfirmation = readValueAfterLabel(lines, ['Identity Confirmation', 'Identity']);
  const productName = identityConfirmation || readValueAfterLabel(lines, ['Product Name', 'Product', 'Sample Name', 'Compound']);
  const endotoxin = parseEndotoxinAssessment(lines, endotoxinThreshold);

  if (endotoxin.warning) {
    warnings.push(endotoxin.warning);
  }

  return compactFields({
    lab: readLikelyLab(lines),
    coaNumber: readValueAfterLabel(lines, ['COA #', 'COA Number', 'Certificate Number']),
    lotNumber: readValueAfterLabel(lines, ['Lot Number', 'Batch Number', 'Batch', 'Lot']),
    accessionNumber: readValueAfterLabel(lines, ['Accession #', 'Accession Number']),
    productName,
    identityConfirmation: identityConfirmation || productName,
    analysisDate: normalizeDate(readValueAfterLabel(lines, ['Analysis Date', 'Date Tested', 'Test Date'])),
    dateReceived: normalizeDate(readValueAfterLabel(lines, ['Date Received', 'Received Date'])),
    issuedDate: normalizeDate(readValueAfterLabel(lines, ['Issued', 'Issue Date', 'Issued Date'])),
    labeledContent: normalizeMass(readValueAfterLabel(lines, ['Labeled Content', 'Label Claim'])),
    purity: normalizePercent(findFirstMatch(fullText, /([0-9]{1,3}(?:\.[0-9]+)?)\s*%\s*(?:purity|pure)?/i)),
    averageNetContent: normalizeMass(findFirstMatch(fullText, /\b(?:mean|average)[^\n]*?([0-9]+(?:\.[0-9]+)?\s*mg)\b/i)),
    heavyMetals: parseKeywordStatus(fullText, /heavy metals?/i),
    sterility: parseKeywordStatus(fullText, /sterility|sterile/i),
    endotoxinResult: endotoxin.result,
    endotoxinThreshold: endotoxin.threshold,
    endotoxins: endotoxin.found ? endotoxin.status : parseKeywordStatus(fullText, /endotoxin/i),
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

export function parseNetPeptideContent(lines) {
  for (const rowLabel of ['Net Blend Peptide Content', 'Net Peptide Content']) {
    const result = normalizeMass(findTableResult(lines, rowLabel, 'mg'));

    if (result) {
      return result;
    }
  }

  return '';
}

export function resolveEndotoxinThreshold(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return {
      valid: true,
      value: defaultEndotoxinPassThresholdEuMl,
      display: `${defaultEndotoxinPassThresholdEuMl} EU/mL`,
    };
  }

  const parsed = Number(String(value).trim());

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      valid: false,
      value: null,
      display: '',
    };
  }

  return {
    valid: true,
    value: parsed,
    display: `${parsed} EU/mL`,
  };
}

export function parseEndotoxinAssessment(lines, threshold = resolveEndotoxinThreshold()) {
  const startIndex = lines.findIndex((line) => /Endotoxin(?:\s+Testing|\s*\(USP|$)/i.test(sanitizeText(line)));

  if (startIndex === -1) {
    return {
      found: false,
      result: '',
      threshold: '',
      status: 'Pending',
      warning: '',
    };
  }

  const endIndex = lines.findIndex((line, index) => (
    index > startIndex && /Notes & Methodology|COA #|Certificate of Analysis/i.test(sanitizeText(line))
  ));
  const sectionLines = lines.slice(startIndex, endIndex === -1 ? Math.min(lines.length, startIndex + 80) : endIndex);
  const explicitStatus = sectionLines
    .map((line) => normalizePassFail(line))
    .find(Boolean) || '';
  const quantitative = findEndotoxinQuantitativeResult(sectionLines);

  if (explicitStatus) {
    return {
      found: true,
      result: quantitative.display,
      threshold: '',
      status: explicitStatus,
      warning: '',
    };
  }

  if (!quantitative.display) {
    return {
      found: true,
      result: '',
      threshold: '',
      status: 'Pending',
      warning: '',
    };
  }

  if (!threshold?.valid) {
    return {
      found: true,
      result: quantitative.display,
      threshold: '',
      status: 'Pending',
      warning: 'HELIX_ENDOTOXIN_PASS_THRESHOLD_EU_ML must be a finite number greater than zero; endotoxin status was left Pending.',
    };
  }

  return {
    found: true,
    result: quantitative.display,
    threshold: threshold.display,
    status: quantitative.value < threshold.value ? 'Pass' : 'Fail',
    warning: '',
  };
}

function findEndotoxinQuantitativeResult(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = sanitizeText(lines[index]);
    const combinedMatch = line.match(/^([0-9]+(?:\.[0-9]+)?)\s*EU\s*\/\s*mL$/i);

    if (combinedMatch) {
      return {
        value: Number(combinedMatch[1]),
        display: `${combinedMatch[1]} EU/mL`,
      };
    }

    const numberMatch = line.match(/^([0-9]+(?:\.[0-9]+)?)$/);
    const nextLine = sanitizeText(lines[index + 1]);

    if (numberMatch && /^EU\s*\/\s*mL$/i.test(nextLine)) {
      return {
        value: Number(numberMatch[1]),
        display: `${numberMatch[1]} EU/mL`,
      };
    }
  }

  return {
    value: Number.NaN,
    display: '',
  };
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
    identityConfirmation: sanitizeText(fields.identityConfirmation).slice(0, 120),
    analysisDate: sanitizeText(fields.analysisDate).slice(0, 40),
    dateReceived: sanitizeText(fields.dateReceived).slice(0, 40),
    issuedDate: sanitizeText(fields.issuedDate).slice(0, 40),
    labeledContent: sanitizeText(fields.labeledContent).slice(0, 40),
    purity: sanitizeText(fields.purity).slice(0, 40),
    averageNetContent: sanitizeText(fields.averageNetContent).slice(0, 40),
    meanPurity: sanitizeText(fields.meanPurity).slice(0, 40),
    endotoxinResult: sanitizeText(fields.endotoxinResult).slice(0, 40),
    endotoxinThreshold: sanitizeText(fields.endotoxinThreshold).slice(0, 40),
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
