import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { doesParsedLotMatchBatch, parseCoaPdfUploadBuffer } from '../server/coa-pdf-parser.mjs';

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

for (const fixtureCase of fixtureCases) {
  const fixturePath = resolveLocalCoaFixture(fixtureCase.fileName);

  test(`parses ILS COA fixture ${fixtureCase.fileName}`, { skip: !fixturePath }, async () => {
    const pdf = await readFile(fixturePath);
    const result = await parseCoaPdfUploadBuffer(pdf, { fileName: fixtureCase.fileName });
    const parsed = result.parsedCoa;

    assert.equal(parsed.templateId, 'ils_laboratories_coa');
    assert.equal(parsed.pageCount, 2);
    assert.equal(parsed.fields.lab, 'ILS Laboratories');
    assert.equal(parsed.fields.lotNumber, fixtureCase.lotNumber);
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
