import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldUseNetlifyBlobs } from '../server/helix-data.mjs';

test('Netlify function runtime uses Netlify Blobs instead of local data files', () => {
  const previousEnv = {
    AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
    HELIX_DATA_ADAPTER: process.env.HELIX_DATA_ADAPTER,
    LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT,
    NETLIFY: process.env.NETLIFY,
  };

  delete process.env.HELIX_DATA_ADAPTER;
  delete process.env.NETLIFY;
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'helix-group-testing-data';
  process.env.LAMBDA_TASK_ROOT = '/var/task';

  try {
    assert.equal(shouldUseNetlifyBlobs(), true);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('local override keeps local data adapter available for development', () => {
  const previousValue = process.env.HELIX_DATA_ADAPTER;

  process.env.HELIX_DATA_ADAPTER = 'local';

  try {
    assert.equal(shouldUseNetlifyBlobs(), false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.HELIX_DATA_ADAPTER;
    } else {
      process.env.HELIX_DATA_ADAPTER = previousValue;
    }
  }
});
