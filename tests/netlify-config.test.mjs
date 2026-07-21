import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('production redirects route COA asset requests before the SPA fallback', async () => {
  const redirects = await readFile('netlify/production-redirects', 'utf8');
  const coaRedirectIndex = redirects.indexOf('/api/coas/*');
  const spaFallbackIndex = redirects.indexOf('/*             /index.html');

  assert.notEqual(coaRedirectIndex, -1);
  assert.notEqual(spaFallbackIndex, -1);
  assert.ok(coaRedirectIndex < spaFallbackIndex);
  assert.match(redirects, /\/api\/coas\/\*\s+\/\.netlify\/functions\/data\/coas\/:splat\s+200/);
});

test('production redirects route account requests before the SPA fallback', async () => {
  const redirects = await readFile('netlify/production-redirects', 'utf8');
  const accountRedirectIndex = redirects.indexOf('/api/account/*');
  const spaFallbackIndex = redirects.indexOf('/*             /index.html');

  assert.notEqual(accountRedirectIndex, -1);
  assert.notEqual(spaFallbackIndex, -1);
  assert.ok(accountRedirectIndex < spaFallbackIndex);
  assert.match(
    redirects,
    /\/api\/account\/\*\s+\/\.netlify\/functions\/account\/:splat\s+200/,
  );
});

test('Netlify Dev leaves frontend routes to Vite instead of installing the production SPA fallback', async () => {
  const config = await readFile('netlify.toml', 'utf8');

  assert.doesNotMatch(config, /from = "\/\*"/);
  assert.match(
    config,
    /\[dev\]\s+command = "npm run dev:netlify"\s+targetPort = 5173\s+publish = "public"/,
  );
});

test('Netlify Dev forces API requests through functions instead of Vite middleware', async () => {
  const config = await readFile('netlify.toml', 'utf8');
  const apiRedirects = [...config.matchAll(
    /\[\[redirects\]\]\s+from = "\/api\/[^\"]+"\s+to = "\/\.netlify\/functions\/[^\"]+"\s+status = 200\s+force = true/g,
  )];

  assert.equal(apiRedirects.length, 6);
});

test('Netlify Dev applies database migrations before starting Vite', async () => {
  const [config, packageJson] = await Promise.all([
    readFile('netlify.toml', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
  ]);

  assert.match(
    config,
    /\[dev\]\s+command = "npm run dev:netlify"\s+targetPort = 5173\s+publish = "public"/,
  );
  assert.doesNotMatch(config, /\[context\.preview-server(?:\.|\])/);
  assert.equal(packageJson.scripts['dev:netlify'], 'node scripts/start-netlify-dev.mjs');
  assert.match(packageJson.scripts.build, /node scripts\/copy-production-redirects\.mjs$/);

  const startupScript = await readFile('scripts/start-netlify-dev.mjs', 'utf8');
  assert.match(startupScript, /PGUSER: process\.env\.PGUSER \|\| 'netlify'/);
  assert.match(startupScript, /\['database', 'migrations', 'apply'\]/);
  assert.ok(
    startupScript.indexOf("['database', 'migrations', 'apply']")
      < startupScript.indexOf("viteCliPath, ['--host', '0.0.0.0']"),
  );
});
