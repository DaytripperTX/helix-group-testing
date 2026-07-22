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

test('account status refreshes from events without constant polling', async () => {
  const [appSource, accountPageSource, adminPageSource, labelsPageSource, sessionEventSource] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/AccountPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/AdminPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/LabelsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/account-session-events.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(appSource, /fetchCurrentAccountSession\(\)/);
  assert.match(appSource, /window\.addEventListener\('focus', refreshWhenVisible\)/);
  assert.match(appSource, /window\.addEventListener\('online', refreshWhenVisible\)/);
  assert.match(appSource, /window\.addEventListener\('pageshow', refreshWhenVisible\)/);
  assert.match(appSource, /window\.addEventListener\(accountSessionRefreshEvent, refreshFromEvent\)/);
  assert.match(appSource, /onAuthChange\(refreshFromEvent\)/);
  assert.match(appSource, /new BroadcastChannel\(accountSessionRefreshChannel\)/);
  assert.match(appSource, /postMessage\(accountSessionRefreshMessage\)/);
  assert.match(appSource, /setAdminSession\(resolveClientAdminSession\(nextAccountSession/);
  assert.match(accountPageSource, /setAdminAccessRequests\(result\.requests\)/);
  assert.match(accountPageSource, /window\.addEventListener\('online', refreshWhenVisible\)/);
  assert.match(accountPageSource, /window\.addEventListener\('pageshow', refreshWhenVisible\)/);
  assert.match(adminPageSource, /notifyAccountAuthorizationFailure\(response\)/);
  assert.match(labelsPageSource, /notifyAccountAuthorizationFailure\(response\)/);
  assert.match(sessionEventSource, /response\.status === 401 \|\| response\.status === 403/);
  assert.doesNotMatch(appSource, /setInterval|clearInterval|accountRoleRefreshMs/);
  assert.doesNotMatch(accountPageSource, /setInterval|clearInterval|adminRequestRefreshMs/);
});

test('account action messages clear automatically except for confirmation-email instructions', async () => {
  const source = await readFile(new URL('../src/AccountPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /const accountStatusDurationMs = 5_000/);
  assert.match(source, /'Check your email to confirm your account\.'/);
  assert.match(source, /'Check your email for the confirmation link before signing in\.'/);
  assert.match(source, /persistentAccountStatusMessages\.has\(status\)/);
  assert.match(
    source,
    /window\.setTimeout\(\(\) => setStatus\(''\), accountStatusDurationMs\)/,
  );
  assert.match(source, /return \(\) => window\.clearTimeout\(timeoutId\)/);
});

test('account session reloads use Netlify cookie credentials without an Authorization header', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sessionFetchStart = source.indexOf("fetch('/api/account/session'");
  const sessionFetch = source.slice(sessionFetchStart, sessionFetchStart + 180);

  assert.notEqual(sessionFetchStart, -1);
  assert.match(sessionFetch, /credentials: 'same-origin'/);
  assert.doesNotMatch(sessionFetch, /authorization|createIdentityRequestHeaders/i);
});
