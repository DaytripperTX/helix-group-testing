import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { doesParsedLotMatchBatch, parseCoaPdfBuffer } from '../server/coa-pdf-parser.mjs';

const fixtureCases = [
  {
    fileName: 'CR-3XAG-30MG-2606-2.pdf',
    lotNumber: 'CR-3XAG-30MG-2606-2',
    purity: '99.85%',
    averageNetContent: '31.71 mg',
    verificationPath: '/2qgRtQeSmLEps64L',
  },
  {
    fileName: 'CR-MOTSC40-2606-BLUE.pdf',
    lotNumber: 'CR-MOTSC40-2606-BLUE',
    purity: '99.84%',
    averageNetContent: '42.61 mg',
    verificationPath: '/BbI200sytFsY4ccJ',
  },
  {
    fileName: 'CR-TESA20-2606-GRAY.pdf',
    lotNumber: 'CR-TESA20-2606-GRAY',
    purity: '99.78%',
    averageNetContent: '20.87 mg',
    verificationPath: '/jVRGVT5XYzZnyPci',
  },
];

for (const fixtureCase of fixtureCases) {
  const fixturePath = resolveLocalCoaFixture(fixtureCase.fileName);

  test(`parses ILS COA fixture ${fixtureCase.fileName}`, { skip: !fixturePath }, async () => {
    const pdf = await readFile(fixturePath);
    const parsed = await parseCoaPdfBuffer(pdf, { fileName: fixtureCase.fileName });

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
