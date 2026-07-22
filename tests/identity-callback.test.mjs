import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hasIdentityCallbackHash } from '../src/identity-callback.mjs';

test('Identity callback hashes are recognized regardless of parameter order', () => {
  assert.equal(hasIdentityCallbackHash('#access_token=secret&token_type=bearer'), true);
  assert.equal(hasIdentityCallbackHash('#token_type=bearer&access_token=secret'), true);
  assert.equal(hasIdentityCallbackHash('#expires_in=3600&confirmation_token=secret'), true);
});

test('unrelated and empty hashes are not treated as Identity callbacks', () => {
  assert.equal(hasIdentityCallbackHash(''), false);
  assert.equal(hasIdentityCallbackHash('#faq'), false);
  assert.equal(hasIdentityCallbackHash('#access_token='), false);
});

test('the account page retries its server session after a successful Identity callback', async () => {
  const source = await readFile(new URL('../src/AccountPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /if \(!resolvedSession\.isAuthenticated\) \{\s+resolvedSession = await onRefreshSession\(\);/);
  assert.match(source, /resolvedSession\.onboardingRequired/);
  assert.match(source, /identityCallbackNotice\.type === 'confirmation'\s+\?\s+'Email confirmed\. Signed in\.'/);
});
