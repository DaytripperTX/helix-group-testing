import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';

const testDataDir = path.resolve('.tmp', 'label-security-test-data');
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');
const {
  adminUpsertLabelTemplate,
  deleteCollectionItem,
  permanentlyDeleteLabelTemplate,
  recoverLabelTemplate,
  readCollection,
  readPublicLabelTemplates,
} = await import('../server/helix-data.mjs');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzX7cgAAAABJRU5ErkJggg==';
const validPreviewDataUrl = `data:image/png;base64,${pngBase64}`;

test('public label upload normalizes ids and rejects caller overwrite control', async () => {
  await resetData();
  const first = await postLabel({ id: 'attacker-id', templateName: 'Clean Label' });
  const second = await postLabel({ id: 'attacker-id', templateName: 'Clean Label Copy' });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);

  const labels = await readCollection('label-templates');

  assert.equal(labels.length, 2);
  assert.notEqual(labels[0].id, 'attacker-id');
  assert.notEqual(labels[1].id, 'attacker-id');
  assert.notEqual(labels[0].id, labels[1].id);
  assert.equal(labels[0].moderationStatus, 'unreviewed');
  assert.equal(labels[0].votes, 0);
  assert.equal(labels[0].reportCount, 0);
  assert.deepEqual(labels[0].reports, []);
  assert.deepEqual(labels[0].voteFingerprints, []);
  assert.deepEqual(labels[0].reportFingerprints, []);

  const publicLabels = await readPublicLabelTemplates();

  assert.equal(publicLabels.length, 2);
  assert.equal(publicLabels[0].moderationStatus, 'unreviewed');
});

test('public label upload rejects unsafe preview data and blocked text', async () => {
  await resetData();

  await assertRejectsUpload({ previewDataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg />').toString('base64')}` });
  await assertRejectsUpload({ previewDataUrl: `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}` });
  await assertRejectsUpload({ previewDataUrl: 'https://example.test/preview.png' });
  await assertRejectsUpload({ previewDataUrl: 'data:image/png;base64,not-base64' });

  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversized);
  await assertRejectsUpload({ previewDataUrl: `data:image/png;base64,${oversized.toString('base64')}` });

  await assertRejectsUpload({ templateName: 'shit label' });
  await assertRejectsUpload({ niimbotCode: 'x'.repeat(20 * 1024 + 1) });
});

test('reports hide labels publicly at five distinct reporters while admin can clear and approve', async () => {
  await resetData();
  await postLabel();

  const [label] = await readCollection('label-templates');

  for (let index = 0; index < 4; index += 1) {
    const response = await apiRequest('/api/labels/report', 'POST', {
      id: label.id,
      reason: 'spam',
      details: `Report ${index + 1}`,
    }, {
      ip: `192.0.2.${index + 1}`,
      userAgent: 'label-report-test',
    });

    assert.equal(response.statusCode, 200);
  }

  assert.equal((await readPublicLabelTemplates()).length, 1);

  const duplicateReport = await apiRequest('/api/labels/report', 'POST', {
    id: label.id,
    reason: 'spam',
    details: 'Duplicate report',
  }, {
    ip: '192.0.2.1',
    userAgent: 'label-report-test',
  });

  assert.equal(duplicateReport.statusCode, 200);
  assert.equal((await readPublicLabelTemplates()).length, 1);

  const finalReport = await apiRequest('/api/labels/report', 'POST', {
    id: label.id,
    reason: 'spam',
    details: 'Report 5',
  }, {
    ip: '192.0.2.5',
    userAgent: 'label-report-test',
  });

  assert.equal(finalReport.statusCode, 200);
  assert.deepEqual(await readPublicLabelTemplates(), []);

  const [reportedLabel] = await readCollection('label-templates');

  assert.equal(reportedLabel.reportCount, 5);
  assert.equal(reportedLabel.reports.length, 5);
  assert.equal(reportedLabel.reportFingerprints.length, 5);
  assert.ok(reportedLabel.reports.every((report) => typeof report.fingerprint === 'string'));

  await adminUpsertLabelTemplate({
    ...reportedLabel,
    moderationStatus: 'approved',
    clearReports: true,
  });

  const publicLabels = await readPublicLabelTemplates();

  assert.equal(publicLabels.length, 1);
  assert.equal(publicLabels[0].moderationStatus, 'approved');
  assert.equal(publicLabels[0].reportCount, 0);
  assert.equal(publicLabels[0].reports, undefined);
  assert.equal(publicLabels[0].reportFingerprints, undefined);
  assert.equal(publicLabels[0].voteFingerprints, undefined);

  await adminUpsertLabelTemplate({
    ...publicLabels[0],
    moderationStatus: 'rejected',
  });

  assert.deepEqual(await readPublicLabelTemplates(), []);
});

test('vote endpoint dedupes fingerprints and changes only votes', async () => {
  await resetData();
  await postLabel({ templateName: 'Original Template' });

  const [label] = await readCollection('label-templates');
  const client = {
    ip: '198.51.100.44',
    userAgent: 'label-vote-test',
  };
  const firstVote = await apiRequest('/api/labels/vote', 'POST', {
    id: label.id,
    direction: 1,
    templateName: 'Mutated Template',
    previewDataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg />').toString('base64')}`,
  }, client);
  const duplicateVote = await apiRequest('/api/labels/vote', 'POST', {
    id: label.id,
    direction: 1,
  }, client);

  assert.equal(firstVote.statusCode, 200);
  assert.equal(duplicateVote.statusCode, 200);

  let [updatedLabel] = await readCollection('label-templates');

  assert.equal(updatedLabel.votes, 1);
  assert.equal(updatedLabel.voteFingerprints.length, 1);
  assert.equal(updatedLabel.templateName, 'Original Template');
  assert.equal(updatedLabel.previewDataUrl, validPreviewDataUrl);

  const removeVote = await apiRequest('/api/labels/vote', 'POST', {
    id: label.id,
    direction: -1,
  }, client);
  const duplicateRemove = await apiRequest('/api/labels/vote', 'POST', {
    id: label.id,
    direction: -1,
  }, client);

  assert.equal(removeVote.statusCode, 200);
  assert.equal(duplicateRemove.statusCode, 200);

  [updatedLabel] = await readCollection('label-templates');

  assert.equal(updatedLabel.votes, 0);
  assert.deepEqual(updatedLabel.voteFingerprints, []);
  assert.equal(JSON.parse(removeVote.body)[0].voteFingerprints, undefined);
});

test('admin delete and reject move labels to trash, then recover or permanently delete', async () => {
  await resetData();
  await postLabel({ templateName: 'Trash Recover' });
  await postLabel({ templateName: 'Trash Delete' });

  let labels = await readCollection('label-templates');
  const recoverLabel = labels.find((label) => label.templateName === 'Trash Recover');
  const deleteLabel = labels.find((label) => label.templateName === 'Trash Delete');

  await adminUpsertLabelTemplate({
    ...recoverLabel,
    moderationStatus: 'rejected',
  });
  await deleteCollectionItem('label-templates', deleteLabel.id);

  labels = await readCollection('label-templates');

  const trashedRecoverLabel = labels.find((label) => label.id === recoverLabel.id);
  const trashedDeleteLabel = labels.find((label) => label.id === deleteLabel.id);

  assert.equal(trashedRecoverLabel.moderationStatus, 'rejected');
  assert.equal(trashedRecoverLabel.deletedReason, 'rejected');
  assert.equal(typeof trashedRecoverLabel.deletedAt, 'string');
  assert.equal(trashedDeleteLabel.deletedReason, 'admin');
  assert.equal((await readPublicLabelTemplates()).length, 0);

  await recoverLabelTemplate(recoverLabel.id);
  labels = await readCollection('label-templates');

  const activeRecoveredLabel = labels.find((label) => label.id === recoverLabel.id);

  assert.equal(activeRecoveredLabel.moderationStatus, 'unreviewed');
  assert.equal(activeRecoveredLabel.deletedAt, undefined);
  assert.equal((await readPublicLabelTemplates()).length, 1);

  await permanentlyDeleteLabelTemplate(deleteLabel.id);
  labels = await readCollection('label-templates');

  assert.equal(labels.some((label) => label.id === deleteLabel.id), false);
});

test('trash labels older than five days are purged on label reads', async () => {
  await resetData();
  await postLabel({ templateName: 'Expired Trash' });

  const [label] = await readCollection('label-templates');
  const oldDeletedAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

  await adminUpsertLabelTemplate({
    ...label,
    moderationStatus: 'rejected',
    deletedAt: oldDeletedAt,
    deletedReason: 'admin',
  });

  const labels = await readCollection('label-templates');

  assert.deepEqual(labels, []);
});

test('public upload throttle allows ten posts per hour per client', async () => {
  await resetData();
  const client = {
    userAgent: 'label-security-throttle-test',
    ip: '192.0.2.44',
  };

  for (let index = 0; index < 10; index += 1) {
    const response = await apiRequest('/api/labels', 'POST', createLabelBody({
      templateName: `Clean Template ${index}`,
    }), client);

    assert.equal(response.statusCode, 200);
  }

  const throttled = await apiRequest('/api/labels', 'POST', createLabelBody({
    templateName: 'Clean Template 11',
  }), client);

  assert.equal(throttled.statusCode, 429);
});

async function resetData() {
  await rm(testDataDir, { recursive: true, force: true });
}

async function postLabel(overrides = {}) {
  return apiRequest('/api/labels', 'POST', createLabelBody(overrides));
}

async function assertRejectsUpload(overrides = {}) {
  const response = await postLabel(overrides);

  assert.equal(response.statusCode, 400);
}

async function apiRequest(pathname, method, body, client = {}) {
  return handleHelixApiRequest({
    method,
    pathname,
    url: pathname,
    headers: {
      'user-agent': client.userAgent ?? `label-security-test-${Math.random()}`,
      'x-forwarded-for': client.ip ?? `127.0.0.${Math.floor(Math.random() * 200) + 1}`,
    },
    bodyText: JSON.stringify(body),
  });
}

function createLabelBody(overrides = {}) {
  return {
    previewDataUrl: validPreviewDataUrl,
    previewFileName: 'preview.png',
    niimbotCode: 'NIIMBOT-CODE',
    templateName: 'Clean Template',
    peptideName: 'BPC-157',
    massMg: '10',
    labelSize: '40x20 mm',
    peptideCategories: ['Recovery'],
    tags: ['minimal', 'clean'],
    formStartedAt: Date.now() - 3000,
    honeypot: '',
    ...overrides,
  };
}
