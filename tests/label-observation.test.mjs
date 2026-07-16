import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeLabelObservation } from '../server/helix-data.mjs';

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const startedAt = Date.parse('2026-07-16T15:46:27.000Z');

test('label observation gate passes after three continuous days', () => {
  const result = summarizeLabelObservation({
    verificationHistory: [0, 12, 24, 36, 48, 60, 72].map((hours) => ({
      checkedAt: new Date(startedAt + hours * hourMs).toISOString(),
      isExact: true,
      observationReset: false,
    })),
    failures: [],
    unresolvedFailures: [],
  }, startedAt + 3 * dayMs);

  assert.equal(result.requiredDays, 3);
  assert.equal(result.maximumVerificationGapHours, 24);
  assert.equal(result.eligibleForCutover, true);
  assert.equal(result.reason, 'gate-passed');
});

test('label observation gate remains incomplete before three days', () => {
  const result = summarizeLabelObservation({
    verificationHistory: [0, 12, 24, 36, 48, 60].map((hours) => ({
      checkedAt: new Date(startedAt + hours * hourMs).toISOString(),
      isExact: true,
      observationReset: false,
    })),
    failures: [],
    unresolvedFailures: [],
  }, startedAt + 71 * hourMs);

  assert.equal(result.eligibleForCutover, false);
  assert.equal(result.reason, 'three-day-window-incomplete');
});

test('label observation gate rejects verification gaps over 24 hours', () => {
  const result = summarizeLabelObservation({
    verificationHistory: [0, 12, 36.5, 48, 60, 72].map((hours) => ({
      checkedAt: new Date(startedAt + hours * hourMs).toISOString(),
      isExact: true,
      observationReset: false,
    })),
    failures: [],
    unresolvedFailures: [],
  }, startedAt + 3 * dayMs);

  assert.equal(result.eligibleForCutover, false);
  assert.equal(result.reason, 'daily-verification-gap');
});
