import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getAuthenticatedAccountUrl } from '../src/account-url.mjs';

test('authenticated account URLs remove only the stale auth mode parameter', () => {
  assert.equal(
    getAuthenticatedAccountUrl('https://preview.test/account?mode=signin'),
    '/account',
  );
  assert.equal(
    getAuthenticatedAccountUrl('https://preview.test/account?mode=signup&source=menu#details'),
    '/account?source=menu#details',
  );
  assert.equal(
    getAuthenticatedAccountUrl('https://preview.test/labels?mode=signin'),
    '',
  );
});

test('account roles and owner requests refresh on focus, visibility, and a short interval', async () => {
  const [appSource, accountPageSource] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/AccountPage.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(appSource, /const accountRoleRefreshMs = 5_000/);
  assert.match(appSource, /fetchCurrentAccountSession\(\)/);
  assert.match(appSource, /window\.addEventListener\('focus', refreshWhenVisible\)/);
  assert.match(appSource, /setAdminSession\(resolveClientAdminSession\(nextAccountSession/);
  assert.match(accountPageSource, /const adminRequestRefreshMs = 5_000/);
  assert.match(accountPageSource, /setAdminAccessRequests\(result\.requests\)/);
});

test('account session reloads use Netlify cookie credentials without an Authorization header', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sessionFetchStart = source.indexOf("fetch('/api/account/session'");
  const sessionFetch = source.slice(sessionFetchStart, sessionFetchStart + 180);

  assert.notEqual(sessionFetchStart, -1);
  assert.match(sessionFetch, /credentials: 'same-origin'/);
  assert.doesNotMatch(sessionFetch, /authorization|createIdentityRequestHeaders/i);
});
