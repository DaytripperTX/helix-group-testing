import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Netlify routes COA asset requests to the data function before SPA fallback', async () => {
  const config = await readFile('netlify.toml', 'utf8');
  const coaRedirectIndex = config.indexOf('from = "/api/coas/*"');
  const spaFallbackIndex = config.indexOf('from = "/*"');

  assert.notEqual(coaRedirectIndex, -1);
  assert.notEqual(spaFallbackIndex, -1);
  assert.ok(coaRedirectIndex < spaFallbackIndex);
  assert.match(config, /from = "\/api\/coas\/\*"\s+to = "\/\.netlify\/functions\/data\/coas\/:splat"\s+status = 200/);
});

test('Netlify routes account requests to the Identity-aware function before SPA fallback', async () => {
  const config = await readFile('netlify.toml', 'utf8');
  const accountRedirectIndex = config.indexOf('from = "/api/account/*"');
  const spaFallbackIndex = config.indexOf('from = "/*"');

  assert.notEqual(accountRedirectIndex, -1);
  assert.notEqual(spaFallbackIndex, -1);
  assert.ok(accountRedirectIndex < spaFallbackIndex);
  assert.match(
    config,
    /from = "\/api\/account\/\*"\s+to = "\/\.netlify\/functions\/account\/:splat"\s+status = 200/,
  );
});
