import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { NetlifyDB } from '@netlify/database-dev';
import {
  canonicalizeLabelTemplate,
  isPubliclyVisibleLabelTemplate,
} from '../server/helix-label-domain.mjs';
import * as repository from '../server/helix-label-postgres.mjs';

const migrationsDirectory = new URL('../netlify/database/migrations/', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const database = new NetlifyDB({ logger: () => {} });

before(async () => {
  process.env.NETLIFY_DB_URL = await database.start();
  process.env.NETLIFY_DB_DRIVER = 'server';
  repository.resetLabelDatabaseClientForTests();
});

beforeEach(async () => {
  await repository.closeLabelDatabaseClientForTests();
  await database.reset();
  const applied = await database.applyMigrations(migrationsDirectory);

  assert.deepEqual(applied, [
    '20260714000100_create-label-storage',
    '20260717000100_create-user-accounts',
    '20260719000100_add-admin-access-approval',
  ]);
});

after(async () => {
  await repository.closeLabelDatabaseClientForTests();
  await database.stop();
  delete process.env.NETLIFY_DB_URL;
  delete process.env.NETLIFY_DB_DRIVER;
});

test('migration and repository preserve the complete relational label shape', async () => {
  const item = createLabel({
    peptideCategories: ['Recovery', 'Repair'],
    tags: ['minimal', 'clean'],
    votes: 2,
    voteFingerprints: ['vote-z', 'vote-a'],
    reportCount: 2,
    reports: [
      {
        reason: 'spam',
        details: 'First report',
        fingerprint: 'report-z',
        createdAt: '2026-07-14T10:00:00.000Z',
      },
      {
        reason: 'unsafe',
        details: 'Second report',
        createdAt: '2026-07-14T10:00:00.000Z',
      },
    ],
    reportFingerprints: ['report-extra', 'report-z'],
  });

  assert.equal((await repository.upsertPostgresLabelSnapshot(item)).status, 'inserted');

  const stored = await repository.readPostgresLabelTemplate(item.id);

  assert.deepEqual(canonicalizeLabelTemplate(stored), canonicalizeLabelTemplate(item));
  assert.deepEqual(stored.peptideCategories, ['Recovery', 'Repair']);
  assert.deepEqual(stored.tags, ['minimal', 'clean']);
  assert.deepEqual(stored.voteFingerprints, ['vote-z', 'vote-a']);
  assert.deepEqual(stored.reportFingerprints, ['report-extra', 'report-z']);
  assert.equal(stored.reports[1].fingerprint, undefined);
});

test('transactional votes and reports deduplicate under concurrency and hide at five reports', async () => {
  const item = createLabel();
  await repository.upsertPostgresLabelSnapshot(item);

  await Promise.all(Array.from({ length: 8 }, () => repository.votePostgresLabelTemplate({
    itemId: item.id,
    fingerprint: 'same-voter',
    direction: 1,
    now: new Date().toISOString(),
  })));

  let stored = await repository.readPostgresLabelTemplate(item.id);
  assert.equal(stored.votes, 1);
  assert.deepEqual(stored.voteFingerprints, ['same-voter']);

  await Promise.all(Array.from({ length: 8 }, () => repository.reportPostgresLabelTemplate({
    itemId: item.id,
    fingerprint: 'same-reporter',
    reason: 'spam',
    details: 'Duplicate',
    now: new Date().toISOString(),
  })));

  stored = await repository.readPostgresLabelTemplate(item.id);
  assert.equal(stored.reportCount, 1);

  for (let index = 2; index <= 5; index += 1) {
    await repository.reportPostgresLabelTemplate({
      itemId: item.id,
      fingerprint: `reporter-${index}`,
      reason: 'other',
      details: `Report ${index}`,
      now: new Date(Date.now() + index).toISOString(),
    });
  }

  stored = await repository.readPostgresLabelTemplate(item.id);
  assert.equal(stored.reportCount, 5);
  assert.equal(isPubliclyVisibleLabelTemplate(stored), false);
});

test('admin edits preserve server-owned actions, clear reports explicitly, and support trash lifecycle', async () => {
  const item = createLabel();
  await repository.upsertPostgresLabelSnapshot(item);
  await repository.votePostgresLabelTemplate({
    itemId: item.id,
    fingerprint: 'voter',
    direction: 1,
    now: new Date().toISOString(),
  });
  await repository.reportPostgresLabelTemplate({
    itemId: item.id,
    fingerprint: 'reporter',
    reason: 'spam',
    details: 'Keep me',
    now: new Date().toISOString(),
  });

  let current = await repository.readPostgresLabelTemplate(item.id);
  current = await repository.adminUpdatePostgresLabelTemplate({
    ...current,
    templateName: 'Admin edit',
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  });

  assert.equal(current.templateName, 'Admin edit');
  assert.equal(current.votes, 1);
  assert.equal(current.reportCount, 1);

  current = await repository.adminUpdatePostgresLabelTemplate({
    ...current,
    updatedAt: new Date(Date.now() + 2000).toISOString(),
  }, { clearReports: true });

  assert.equal(current.votes, 1);
  assert.equal(current.reportCount, 0);
  assert.deepEqual(current.reports, []);

  current = await repository.softDeletePostgresLabelTemplate(item.id, 'admin');
  assert.equal(current.deletedReason, 'admin');
  assert.equal(isPubliclyVisibleLabelTemplate(current), false);

  current = await repository.recoverPostgresLabelTemplate(item.id);
  assert.equal(current.deletedAt, undefined);
  assert.equal(current.moderationStatus, 'unreviewed');

  const tombstone = await repository.deletePostgresLabelTemplate(item.id);
  assert.equal(tombstone.permanentlyDeleted, true);
  assert.equal(await repository.readPostgresLabelTemplate(item.id), undefined);
});

test('expired trash is hidden and purged by SQL maintenance', async () => {
  const expired = createLabel({
    id: 'expired-label',
    moderationStatus: 'rejected',
    deletedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    deletedReason: 'admin',
  });

  await repository.upsertPostgresLabelSnapshot(expired, { force: true });
  assert.equal(await repository.readPostgresLabelTemplate(expired.id), undefined);
  await assert.rejects(
    repository.recoverPostgresLabelTemplate(expired.id),
    (error) => error?.statusCode === 404,
  );

  await repository.upsertPostgresLabelSnapshot(expired, { force: true });

  await repository.upsertPostgresLabelSnapshot(createLabel({ id: 'maintenance-trigger' }));
  const result = await database.query('SELECT COUNT(*)::INTEGER AS count FROM label_templates WHERE id = $1', [expired.id]);

  assert.equal(Number(result.rows[0].count), 0);
});

test('verification summaries are timestamped and retain observation reset metadata', async () => {
  const summary = {
    operation: 'repair',
    observationReset: true,
    legacyCount: 1,
    postgresCount: 1,
    matchedCount: 1,
    missingInPostgresIds: [],
    extraInPostgresIds: [],
    differentIds: [],
    blockedIds: [],
    isExact: true,
    legacyHash: 'a'.repeat(64),
    postgresHash: 'a'.repeat(64),
  };

  const record = await repository.recordPostgresLabelVerification(summary);
  const latest = await repository.readLatestPostgresLabelVerification();

  assert.equal(record.operation, 'repair');
  assert.equal(record.observationReset, true);
  assert.equal(record.isExact, true);
  assert.equal(latest.id, record.id);
});

function createLabel(overrides = {}) {
  const now = '2026-07-14T12:00:00.000Z';

  return {
    id: 'postgres-label',
    previewAssetKey: 'label-previews/postgres-label.png',
    previewMimeType: 'image/png',
    previewFileName: 'preview.png',
    previewByteLength: 128,
    previewUrl: '/api/labels/postgres-label/preview',
    niimbotCode: 'NIIMBOT-CODE',
    templateName: 'Postgres Label',
    peptideName: 'BPC-157',
    massMg: '10',
    labelSize: '40x20 mm',
    peptideCategories: ['Recovery'],
    tags: ['clean'],
    votes: 0,
    voteFingerprints: [],
    moderationStatus: 'unreviewed',
    reportCount: 0,
    reports: [],
    reportFingerprints: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
