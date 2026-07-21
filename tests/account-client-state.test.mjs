import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createIdentityRequestHeaders,
  getIdentityAuthorizationHeader,
} from '../src/account-client-auth.mjs';
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

test('Identity JWT cookies are forwarded as same-origin bearer credentials', () => {
  assert.equal(
    getIdentityAuthorizationHeader('other=value; nf_jwt=header.payload%2Esignature'),
    'Bearer header.payload.signature',
  );
  assert.equal(getIdentityAuthorizationHeader('other=value'), '');

  const headers = createIdentityRequestHeaders(
    { 'content-type': 'application/json' },
    'nf_jwt=test-token',
  );
  assert.equal(headers.get('authorization'), 'Bearer test-token');
  assert.equal(headers.get('content-type'), 'application/json');
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
