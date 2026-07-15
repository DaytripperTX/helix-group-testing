import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  compactParsedCoa,
  doesParsedLotMatchBatch,
  findCoaBatchNumber,
  identifyCoaPdfBatchNumber,
  parseCoaPdfUploadBuffer,
  parseEndotoxinAssessment,
  parseNetPeptideContent,
  resolveEndotoxinThreshold,
} from '../server/coa-pdf-parser.mjs';

const fixtureCases = [
  {
    fileName: 'CR-3XAG-30MG-2606-2.pdf',
    lotNumber: 'CR-3XAG-30MG-2606-2',
    purity: '99.85%',
    averageNetContent: '31.71 mg',
    verificationPath: '/2qgRtQeSmLEps64L',
    vialWidth: 560,
    vialHeight: 560,
  },
  {
    fileName: 'CR-MOTSC40-2606-BLUE.pdf',
    lotNumber: 'CR-MOTSC40-2606-BLUE',
    purity: '99.84%',
    averageNetContent: '42.61 mg',
    verificationPath: '/BbI200sytFsY4ccJ',
    vialWidth: 560,
    vialHeight: 747,
  },
  {
    fileName: 'CR-TESA20-2606-GRAY.pdf',
    lotNumber: 'CR-TESA20-2606-GRAY',
    purity: '99.78%',
    averageNetContent: '20.87 mg',
    verificationPath: '/jVRGVT5XYzZnyPci',
    vialWidth: 560,
    vialHeight: 747,
  },
];

const realFixtureCases = [
  {
    fileName: 'HLX-SOP-CP10-2PEP.pdf',
    averageNetContent: '10.17 mg',
  },
  {
    fileName: 'HLX-SOP-RT20-2PEP.pdf',
    averageNetContent: '20.37 mg',
  },
];

test('derives report-only endotoxin status from the default and overridden thresholds', () => {
  const lines = [
    'Endotoxin Testing (USP <85>)',
    'Test',
    'Specification',
    'Result',
    'Status',
    'Endotoxin (USP <85>)',
    'Report Result',
    '0.096 EU/mL',
    'Reported',
    'About this result: no universal pass/fail threshold applies.',
    'Notes & Methodology',
  ];

  assert.deepEqual(parseEndotoxinAssessment(lines, resolveEndotoxinThreshold()), {
    found: true,
    result: '0.096 EU/mL',
    threshold: '5 EU/mL',
    status: 'Pass',
    warning: '',
  });
  assert.equal(
    parseEndotoxinAssessment(lines, resolveEndotoxinThreshold('0.05')).status,
    'Fail',
  );
});

test('treats the endotoxin threshold as strict and leaves invalid configuration pending', () => {
  const boundaryLines = ['Endotoxin Testing', 'Endotoxin', '5 EU/mL', 'Reported', 'Notes & Methodology'];
  const invalid = parseEndotoxinAssessment(boundaryLines, resolveEndotoxinThreshold('not-a-number'));

  assert.equal(parseEndotoxinAssessment(boundaryLines, resolveEndotoxinThreshold()).status, 'Fail');
  assert.equal(invalid.result, '5 EU/mL');
  assert.equal(invalid.threshold, '');
  assert.equal(invalid.status, 'Pending');
  assert.match(invalid.warning, /finite number greater than zero/i);
});

test('preserves an explicit lab endotoxin status', () => {
  const assessment = parseEndotoxinAssessment([
    'Endotoxin Testing',
    'Endotoxin',
    '8 EU/mL',
    'PASS',
    'Notes & Methodology',
  ], resolveEndotoxinThreshold());

  assert.equal(assessment.status, 'Pass');
  assert.equal(assessment.result, '8 EU/mL');
  assert.equal(assessment.threshold, '');
});

test('parses total blend content and a single net peptide content result', () => {
  assert.equal(parseNetPeptideContent([
    'Net Blend Peptide Content',
    'Report Only',
    '10.17',
    'mg',
    'N/A',
    '-- CJC-1295',
    '4.98',
    'mg',
  ]), '10.17 mg');
  assert.equal(parseNetPeptideContent([
    'Net Peptide Content',
    'Report Only',
    '20.37',
    'mg',
    'N/A',
  ]), '20.37 mg');
});

test('normalization preserves the recorded parser version on existing COAs', () => {
  assert.equal(compactParsedCoa({ parserVersion: 'coa-pdf-parser-v1' }).parserVersion, 'coa-pdf-parser-v1');
});

test('finds batch numbers from labeled and inline first-page text', () => {
  assert.equal(findCoaBatchNumber(['Lot Number:', 'HLX-SOP-RT20-2PEP']), 'HLX-SOP-RT20-2PEP');
  assert.equal(
    findCoaBatchNumber(['COA: COA-2026-FHQ1Q8 | Lot: HLX-SOP-RT20-2PEP']),
    'HLX-SOP-RT20-2PEP',
  );
});

{
  const fixtureCase = fixtureCases[0];
  const fixturePath = resolveLocalCoaFixture(fixtureCase.fileName);

  test('parses COA fixture when serverless DOM canvas globals are missing', { skip: !fixturePath }, async () => {
    const originalDOMMatrix = globalThis.DOMMatrix;
    const originalPath2D = globalThis.Path2D;
    const originalImageData = globalThis.ImageData;
    const originalPdfJsWorker = globalThis.pdfjsWorker;

    delete globalThis.DOMMatrix;
    delete globalThis.Path2D;
    delete globalThis.ImageData;
    delete globalThis.pdfjsWorker;

    try {
      const pdf = await readFile(fixturePath);
      const result = await parseCoaPdfUploadBuffer(pdf, { fileName: fixtureCase.fileName });

      assert.equal(typeof globalThis.DOMMatrix, 'function');
      assert.equal(typeof globalThis.Path2D, 'function');
      assert.equal(typeof globalThis.ImageData, 'function');
      assert.equal(typeof globalThis.pdfjsWorker?.WorkerMessageHandler, 'function');
      assert.equal(result.parsedCoa.fields.lotNumber, fixtureCase.lotNumber);
      assert.equal(result.parsedCoa.fields.purity, fixtureCase.purity);
    } finally {
      restoreGlobal('DOMMatrix', originalDOMMatrix);
      restoreGlobal('Path2D', originalPath2D);
      restoreGlobal('ImageData', originalImageData);
      restoreGlobal('pdfjsWorker', originalPdfJsWorker);
    }
  });
}

for (const fixtureCase of fixtureCases) {
  const fixturePath = resolveLocalCoaFixture(fixtureCase.fileName);

  test(`parses ILS COA fixture ${fixtureCase.fileName}`, { skip: !fixturePath }, async () => {
    const pdf = await readFile(fixturePath);
    const result = await parseCoaPdfUploadBuffer(pdf, { fileName: fixtureCase.fileName });
    const parsed = result.parsedCoa;

    assert.equal(parsed.templateId, 'ils_laboratories_coa');
    assert.equal(parsed.parserVersion, 'coa-pdf-parser-v2');
    assert.equal(parsed.pageCount, 2);
    assert.equal(parsed.fields.lab, 'ILS Laboratories');
    assert.equal(parsed.fields.lotNumber, fixtureCase.lotNumber);
    assert.ok(parsed.fields.identityConfirmation);
    assert.equal(parsed.fields.purity, fixtureCase.purity);
    assert.equal(parsed.fields.averageNetContent, fixtureCase.averageNetContent);
    assert.equal(parsed.fields.endotoxins, 'Pass');
    assert.equal(parsed.fields.sterility, 'Pass');
    assert.equal(parsed.fields.heavyMetals, 'Pass');
    assert.equal(parsed.fields.fentanyl, 'Pass');
    assert.ok(parsed.fields.verificationUrl.endsWith(fixtureCase.verificationPath));
    assert.equal(parsed.warnings.length, 0);
    assert.equal(result.vialImage.mimeType, 'image/png');
    assert.equal(result.vialImage.width, fixtureCase.vialWidth);
    assert.equal(result.vialImage.height, fixtureCase.vialHeight);
    assert.equal(result.vialImage.sourceName, 'img_p0_5');
    assert.equal(result.vialImage.operatorIndex, 316);
    assert.equal(result.vialImage.buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(parsed.raw.vialImage.width, fixtureCase.vialWidth);
    assert.equal(parsed.raw.vialImage.height, fixtureCase.vialHeight);
    assert.equal(parsed.raw.vialImage.drawnX, 476.22);
    assert.ok(parsed.raw.vialImage.drawnWidth > 70);
  });
}

for (const fixtureCase of realFixtureCases) {
  const fixturePath = resolveLocalCoaFixture(fixtureCase.fileName);

  test(`parses quantitative real COA fixture ${fixtureCase.fileName}`, { skip: !fixturePath }, async () => {
    const pdf = await readFile(fixturePath);
    const result = await parseCoaPdfUploadBuffer(pdf, { fileName: fixtureCase.fileName });

    assert.equal(result.parsedCoa.parserVersion, 'coa-pdf-parser-v2');
    assert.equal(result.parsedCoa.fields.averageNetContent, fixtureCase.averageNetContent);
    assert.equal(result.parsedCoa.fields.endotoxinResult, '0.096 EU/mL');
    assert.equal(result.parsedCoa.fields.endotoxinThreshold, '5 EU/mL');
    assert.equal(result.parsedCoa.fields.endotoxins, 'Pass');
    assert.equal(result.vialImage, null);
    assert.equal(result.parsedCoa.raw.vialImage, null);
    assert.equal(result.parsedCoa.warnings.includes('COA vial image could not be extracted.'), false);
    assert.equal(await identifyCoaPdfBatchNumber(pdf), fixtureCase.fileName.replace(/\.pdf$/i, ''));
  });
}

{
  const fixtureCase = fixtureCases[0];
  const fixturePath = resolveLocalCoaFixture(fixtureCase.fileName);

  test('continues parsing COA text when no vial image is present', { skip: !fixturePath }, async () => {
    const pdf = await readFile(fixturePath);
    const result = await parseCoaPdfUploadBuffer(pdf, {
      fileName: fixtureCase.fileName,
      imageExtractor: () => [],
    });

    assert.equal(result.parsedCoa.fields.averageNetContent, fixtureCase.averageNetContent);
    assert.equal(result.vialImage, null);
    assert.equal(result.parsedCoa.raw.vialImage, null);
    assert.equal(result.parsedCoa.warnings.includes('COA vial image could not be extracted.'), false);
  });

  test('continues parsing COA text when vial image extraction fails', { skip: !fixturePath }, async () => {
    const pdf = await readFile(fixturePath);
    const originalConsoleError = console.error;

    console.error = () => {};

    try {
      const result = await parseCoaPdfUploadBuffer(pdf, {
        fileName: fixtureCase.fileName,
        imageExtractor: () => {
          throw new Error('Simulated image extraction failure.');
        },
      });
      const parsed = result.parsedCoa;

      assert.equal(parsed.templateId, 'ils_laboratories_coa');
      assert.equal(parsed.fields.lab, 'ILS Laboratories');
      assert.equal(parsed.fields.lotNumber, fixtureCase.lotNumber);
      assert.equal(parsed.fields.purity, fixtureCase.purity);
      assert.equal(parsed.fields.averageNetContent, fixtureCase.averageNetContent);
      assert.equal(parsed.fields.endotoxins, 'Pass');
      assert.equal(parsed.fields.sterility, 'Pass');
      assert.equal(parsed.fields.heavyMetals, 'Pass');
      assert.equal(parsed.fields.fentanyl, 'Pass');
      assert.equal(result.vialImage, null);
      assert.ok(parsed.warnings.includes('COA vial image could not be extracted.'));
    } finally {
      console.error = originalConsoleError;
    }
  });
}

test('parsed lot matching blocks obvious mismatches', () => {
  const parsedCoa = {
    fields: {
      lotNumber: 'CR-3XAG-30MG-2606-2',
    },
  };

  assert.equal(doesParsedLotMatchBatch(parsedCoa, 'CR-3XAG-30MG-2606-2'), true);
  assert.equal(doesParsedLotMatchBatch(parsedCoa, 'CR-MOTSC40-2606-BLUE'), false);
});

function resolveLocalCoaFixture(fileName) {
  const candidates = [
    path.join('.tmp', 'coa-fixtures', fileName),
    path.join(process.env.USERPROFILE || '', 'Downloads', fileName),
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) || '';
}

function restoreGlobal(name, value) {
  if (typeof value === 'undefined') {
    delete globalThis[name];
    return;
  }

  globalThis[name] = value;
}
