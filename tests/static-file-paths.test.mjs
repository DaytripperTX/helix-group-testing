import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';

import {
  isPathInsideDirectory,
  resolveStaticFilePath,
  resolveStaticRequestPath,
} from '../server/static-file-paths.mjs';

const distDir = path.resolve('C:/app/helix/dist');

test('static path containment rejects sibling paths sharing the dist prefix', () => {
  const result = resolveStaticRequestPath(distDir, '/%2e%2e/dist-secrets/private.txt');

  assert.equal(result.statusCode, 403);
});

test('static path containment rejects ordinary parent traversal', () => {
  const result = resolveStaticRequestPath(distDir, '/%2e%2e/data/private.txt');

  assert.equal(result.statusCode, 403);
});

test('static path containment rejects malformed percent encoding', () => {
  const result = resolveStaticRequestPath(distDir, '/%E0%A4%A');

  assert.equal(result.statusCode, 400);
});

test('static path containment allows files inside dist', () => {
  const filePath = path.join(distDir, 'assets', 'example.js');

  assert.equal(isPathInsideDirectory(distDir, filePath), true);
  assert.deepEqual(resolveStaticRequestPath(distDir, '/assets/example.js'), {
    statusCode: 200,
    filePath,
  });
});

test('static file resolver preserves root and SPA fallback behavior', async () => {
  const existingAssetPath = path.join(distDir, 'assets', 'example.js');
  const indexPath = path.join(distDir, 'index.html');
  const existingFiles = new Set([existingAssetPath, indexPath]);
  const isExistingFile = async (filePath) => existingFiles.has(filePath);

  assert.deepEqual(
    await resolveStaticFilePath({
      distDir,
      pathname: '/',
      isExistingFile,
    }),
    {
      statusCode: 200,
      filePath: indexPath,
    },
  );

  assert.deepEqual(
    await resolveStaticFilePath({
      distDir,
      pathname: '/assets/example.js',
      isExistingFile,
    }),
    {
      statusCode: 200,
      filePath: existingAssetPath,
    },
  );

  assert.deepEqual(
    await resolveStaticFilePath({
      distDir,
      pathname: '/some/spa/route',
      isExistingFile,
    }),
    {
      statusCode: 200,
      filePath: indexPath,
    },
  );
});
