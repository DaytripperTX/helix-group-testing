import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const parserVersion = 'coa-pdf-parser-v1';
const maxRawSnippetLength = 1200;

export async function parseCoaPdfBuffer(buffer, options = {}) {
  const data = new Uint8Array(buffer);
  const document = await pdfjs.getDocument({
    data,
    disableWorker: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
  const pages = [];
  const annotationUrls = [];

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

  return compactParsedCoa({
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
    },
  });
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
    },
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
