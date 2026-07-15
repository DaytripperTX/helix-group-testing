import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCoaDetailPath,
  createCoaListPath,
  createCoaPeptideFilterOptions,
  parseCoaFilterSearch,
  serializeCoaFilterSearch,
} from '../src/coa-filter-url.mjs';

test('COA filter URLs use compact ordered parameters and omit defaults', () => {
  assert.equal(serializeCoaFilterSearch({
    roundId: '2pep-round',
    peptideToken: 'retatrutide',
    searchTerm: 'blue vial',
  }), '?r=2pep-round&p=retatrutide&q=blue+vial');
  assert.equal(serializeCoaFilterSearch({
    roundId: 'all',
    peptideToken: 'all',
    searchTerm: '  ',
  }), '');
  assert.equal(createCoaListPath('/coas', {
    roundId: 'all',
    peptideToken: 'cjc-1295-without-dac-ipamorelin',
    searchTerm: '',
  }), '/coas?p=cjc-1295-without-dac-ipamorelin');
});

test('COA filter URLs round-trip URL-sensitive search text without verbose keys', () => {
  const filters = {
    roundId: 'round-1/2',
    peptideToken: 'NAD+',
    searchTerm: 'blue & gray + 10%',
  };
  const search = serializeCoaFilterSearch(filters);

  assert.equal(search, '?r=round-1%2F2&p=NAD%2B&q=blue+%26+gray+%2B+10%25');
  assert.deepEqual(parseCoaFilterSearch(search), filters);
  assert.deepEqual(parseCoaFilterSearch('?round=ignored&r=round-1&extra=value'), {
    roundId: 'round-1',
    peptideToken: 'all',
    searchTerm: '',
  });
});

test('COA detail paths contain only the compact encoded batch hash', () => {
  assert.equal(createCoaDetailPath('/coas', 'HLX SOP/RT20'), '/coas#HLX%20SOP%2FRT20');
  assert.equal(createCoaDetailPath('/coas', ''), '/coas');
});

test('COA peptide filter options prefer stable IDs and provide compact legacy fallbacks', () => {
  assert.deepEqual(createCoaPeptideFilterOptions([
    { peptideName: 'Retatrutide', peptideId: 'retatrutide' },
    { peptideName: 'Retatrutide', peptideId: 'retatrutide' },
    { peptideName: 'Bacteriostatic water', peptideId: '' },
  ]), [
    { label: 'Bacteriostatic water', token: 'bacteriostatic-water' },
    { label: 'Retatrutide', token: 'retatrutide' },
  ]);

  assert.deepEqual(createCoaPeptideFilterOptions([
    { peptideName: 'A+B', peptideId: '' },
    { peptideName: 'A B', peptideId: '' },
  ]), [
    { label: 'A B', token: 'A B' },
    { label: 'A+B', token: 'A+B' },
  ]);
});
