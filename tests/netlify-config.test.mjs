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

test('Netlify Preview Servers apply database migrations before starting Vite', async () => {
  const [config, packageJson] = await Promise.all([
    readFile('netlify.toml', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
  ]);

  assert.match(config, /\[dev\]\s+command = "npm run dev:netlify"\s+targetPort = 5173/);
  assert.match(config, /\[context\.preview-server\.environment\]\s+PGUSER = "netlify"/);
  assert.equal(packageJson.scripts['dev:netlify'], 'node scripts/start-netlify-dev.mjs');

  const startupScript = await readFile('scripts/start-netlify-dev.mjs', 'utf8');
  assert.match(startupScript, /PGUSER: process\.env\.PGUSER \|\| 'netlify'/);
  assert.match(startupScript, /\['database', 'migrations', 'apply'\]/);
  assert.ok(
    startupScript.indexOf("['database', 'migrations', 'apply']")
      < startupScript.indexOf("viteCliPath, ['--host', '0.0.0.0']"),
  );
});
