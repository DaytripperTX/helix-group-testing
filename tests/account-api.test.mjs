import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { NetlifyDB } from '@netlify/database-dev';
import { handleAccountRequest } from '../server/helix-account-api.mjs';
import { handleHelixApiRequest } from '../server/helix-api.mjs';
import { runAccountDeletionCleanup } from '../server/helix-account-cleanup.mjs';
import * as repository from '../server/helix-account-postgres.mjs';

const migrationsDirectory = new URL('../netlify/database/migrations/', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const testDataDir = path.resolve('.tmp', 'account-api-test-data');
const database = new NetlifyDB({ logger: () => {} });

process.env.HELIX_ACCOUNT_ACTION_SECRET = 'test-account-action-secret-with-enough-entropy';
process.env.HELIX_ADMIN_SESSION_SECRET = 'test-coa-and-legacy-cookie-secret';
process.env.HELIX_DATA_ADAPTER = 'local';
process.env.HELIX_LEGACY_ADMIN_AUTH = 'false';
process.env.HELIX_LOCAL_DATA_DIR = testDataDir;
process.env.HELIX_OWNER_EMAIL = 'owner@example.com';
delete process.env.HELIX_ADMIN_INVITE_FROM;
delete process.env.NETLIFY_EMAILS_SECRET;

before(async () => {
  process.env.NETLIFY_DB_URL = await database.start();
  process.env.NETLIFY_DB_DRIVER = 'server';
  repository.resetAccountDatabaseClientForTests();
  await mkdir(testDataDir, { recursive: true });
});

beforeEach(async () => {
  await repository.closeAccountDatabaseClientForTests();
  await database.reset();
  await database.applyMigrations(migrationsDirectory);
  await rm(testDataDir, { recursive: true, force: true });
  await mkdir(testDataDir, { recursive: true });
});

after(async () => {
  await repository.closeAccountDatabaseClientForTests();
  await database.stop();
  await rm(testDataDir, { recursive: true, force: true });
});

test('email signup validates usernames and stores only Identity metadata until confirmation', async () => {
  const identity = createFakeIdentity();
  const response = await accountRequest('/api/account/signup', 'POST', {
    username: 'New_User',
    email: 'new@example.com',
    password: 'a-long-password',
  }, identity);

  assert.equal(response.status, 202);
  assert.equal((await response.json()).requiresConfirmation, true);
  assert.deepEqual(identity.signupCalls, [{
    email: 'new@example.com',
    password: 'a-long-password',
    data: { helix_username: 'New_User' },
  }]);
  assert.equal(await repository.getAccountByIdentityUserId('signed-up-user'), null);

  const reserved = await accountRequest('/api/account/signup', 'POST', {
    username: 'owner',
    email: 'other@example.com',
    password: 'a-long-password',
  }, identity);
  assert.equal(reserved.status, 400);
  assert.match((await reserved.json()).error, /reserved/i);
});

test('email login distinguishes an unconfirmed account from invalid credentials', async () => {
  const unconfirmedIdentity = createFakeIdentity();
  unconfirmedIdentity.login = async () => {
    const error = new Error('Email not confirmed');
    error.status = 400;
    throw error;
  };

  const unconfirmedResponse = await accountRequest('/api/account/login', 'POST', {
    email: 'pending@example.com',
    password: 'correct-password',
  }, unconfirmedIdentity);

  assert.equal(unconfirmedResponse.status, 401);
  assert.deepEqual(await unconfirmedResponse.json(), {
    error: 'Check your email for the confirmation link before signing in.',
  });

  const invalidResponse = await accountRequest('/api/account/login', 'POST', {
    email: 'member@example.com',
    password: 'wrong-password',
  }, createFakeIdentity());

  assert.equal(invalidResponse.status, 401);
  assert.deepEqual(await invalidResponse.json(), {
    error: 'Invalid email or password.',
  });

  const outageIdentity = createFakeIdentity();
  outageIdentity.login = async () => {
    const error = new Error('Email not confirmed');
    error.status = 502;
    throw error;
  };
  const outageResponse = await accountRequest('/api/account/login', 'POST', {
    email: 'pending@example.com',
    password: 'correct-password',
  }, outageIdentity);

  assert.deepEqual(await outageResponse.json(), {
    error: 'Invalid email or password.',
  });
});

test('Google login requires username completion and bootstraps the configured owner', async () => {
  const identity = createFakeIdentity(createIdentityUser({
    id: 'google-owner',
    email: 'owner@example.com',
    provider: 'google',
    username: undefined,
  }));
  const sessionResponse = await accountRequest('/api/account/session', 'GET', undefined, identity);
  const initialSession = await sessionResponse.json();

  assert.equal(initialSession.isAuthenticated, true);
  assert.equal(initialSession.onboardingRequired, true);

  const completedResponse = await accountRequest('/api/account/complete-profile', 'POST', {
    username: 'HelixOwner',
  }, identity);
  const completed = await completedResponse.json();

  assert.equal(completedResponse.status, 200);
  assert.equal(completed.account.role, 'owner');
  assert.equal(identity.adminUpdates[0].attributes.user_metadata.helix_username, 'HelixOwner');
});

test('account session reload keeps an existing account when Identity returns JWT claims only', async () => {
  const fullIdentityUser = createIdentityUser({
    id: 'reload-session-user',
    email: 'reload-session@example.com',
    username: 'ReloadSessionUser',
  });
  const account = (await repository.syncAccountFromIdentity(fullIdentityUser)).account;
  const identity = createFakeIdentity({
    id: fullIdentityUser.id,
    email: fullIdentityUser.email,
    provider: fullIdentityUser.provider,
    userMetadata: {},
  });

  const response = await accountRequest('/api/account/session', 'GET', undefined, identity);
  const session = await response.json();

  assert.equal(response.status, 200);
  assert.equal(session.isAuthenticated, true);
  assert.equal(session.account.id, account.id);
  assert.equal(session.account.username, 'ReloadSessionUser');
});

test('account writes reject cross-origin requests and Google reauthentication must be recent', async () => {
  const identity = createFakeIdentity(createIdentityUser({
    id: 'google-user',
    email: 'google@example.com',
    provider: 'google',
    username: 'GoogleUser',
    lastSignInAt: new Date().toISOString(),
  }));
  await repository.syncAccountFromIdentity(identity.currentUser);

  const crossOriginResponse = await handleAccountRequest(new Request('https://helix.test/api/account/profile/username', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
    },
    body: JSON.stringify({ username: 'StolenName' }),
  }), identity);
  assert.equal(crossOriginResponse.status, 403);

  const recentResponse = await accountRequest('/api/account/reauth/google', 'POST', {}, identity);
  assert.equal(recentResponse.status, 200);
  assert.ok(getCookiePair(recentResponse.headers.get('set-cookie'), 'helix_recent_account_auth'));

  identity.currentUser.lastSignInAt = '2026-07-01T00:00:00.000Z';
  const staleResponse = await accountRequest('/api/account/reauth/google', 'POST', {}, identity);
  assert.equal(staleResponse.status, 401);
});

test('Preview Server account writes accept the external Helix origin but reject lookalikes', async () => {
  const previousEnvironment = {
    NETLIFY_PREVIEW_SERVER: process.env.NETLIFY_PREVIEW_SERVER,
    SITE_NAME: process.env.SITE_NAME,
    URL: process.env.URL,
  };
  const previewOrigin = 'https://devserver-feat-user-accounts--helix-group-testing.netlify.app';
  const identity = createFakeIdentity();

  process.env.NETLIFY_PREVIEW_SERVER = 'true';
  process.env.SITE_NAME = 'helix-group-testing';
  process.env.URL = 'https://helix-group-testing.netlify.app';

  try {
    const accepted = await accountRequest('/api/account/signup', 'POST', {
      username: 'PreviewUser',
      email: 'preview@example.com',
      password: 'a-long-password',
    }, identity, '', {
      requestBaseUrl: 'http://localhost:8888',
      requestOrigin: previewOrigin,
    });
    assert.equal(accepted.status, 202);

    const rejected = await accountRequest('/api/account/signup', 'POST', {
      username: 'LookalikeUser',
      email: 'lookalike@example.com',
      password: 'a-long-password',
    }, identity, '', {
      requestBaseUrl: 'http://localhost:8888',
      requestOrigin: `${previewOrigin}.attacker.example`,
    });
    assert.equal(rejected.status, 403);
  } finally {
    restoreEnvironment(previousEnvironment);
  }
});

test('one reusable link accepts multiple admin requests but only owner approval grants access', async () => {
  const ownerUser = createIdentityUser({
    id: 'identity-owner',
    email: 'owner@example.com',
    username: 'HelixOwner',
  });
  const firstCandidate = createIdentityUser({
    id: 'identity-first-candidate',
    email: 'first@example.com',
    username: 'FirstCandidate',
  });
  const secondCandidate = createIdentityUser({
    id: 'identity-second-candidate',
    email: 'second@example.com',
    username: 'SecondCandidate',
  });
  const identity = createFakeIdentity(ownerUser);
  await repository.syncAccountFromIdentity(ownerUser);
  await repository.syncAccountFromIdentity(firstCandidate);
  await repository.syncAccountFromIdentity(secondCandidate);

  const linkResponse = await accountRequest('/api/account/admin-access-links', 'POST', {}, identity);
  const linkBody = await linkResponse.json();
  const token = new URL(linkBody.adminRequestLink).searchParams.get('admin_request');

  assert.equal(linkResponse.status, 201);
  assert.ok(token);
  assert.equal(new URL(linkBody.adminRequestLink).origin, 'https://helix.test');

  identity.currentUser = firstCandidate;
  const firstResponse = await accountRequest(
    '/api/account/admin-access-requests',
    'POST',
    { token },
    identity,
  );
  assert.equal(firstResponse.status, 202);
  assert.equal((await firstResponse.json()).request.status, 'pending');

  identity.currentUser = secondCandidate;
  const secondResponse = await accountRequest(
    '/api/account/admin-access-requests',
    'POST',
    { token },
    identity,
  );
  assert.equal(secondResponse.status, 202);

  assert.equal((await repository.getAccountByIdentityUserId(firstCandidate.id)).role, 'user');
  assert.equal((await repository.getAccountByIdentityUserId(secondCandidate.id)).role, 'user');

  identity.currentUser = ownerUser;
  const requestsResponse = await accountRequest('/api/account/admin-access-requests', 'GET', undefined, identity);
  const requests = (await requestsResponse.json()).requests;
  const firstRequest = requests.find((request) => request.account.username === 'FirstCandidate');
  const secondRequest = requests.find((request) => request.account.username === 'SecondCandidate');

  assert.equal(requestsResponse.status, 200);
  assert.equal(requests.length, 2);
  assert.equal(firstRequest.account.identityUserId, undefined);

  const approveResponse = await accountRequest(
    `/api/account/admin-access-requests/${firstRequest.id}/approve`,
    'POST',
    {},
    identity,
  );
  const rejectResponse = await accountRequest(
    `/api/account/admin-access-requests/${secondRequest.id}/reject`,
    'POST',
    {},
    identity,
  );

  assert.equal((await approveResponse.json()).account.role, 'admin');
  assert.equal((await rejectResponse.json()).account.role, 'user');

  const admins = await (await accountRequest('/api/account/admins', 'GET', undefined, identity)).json();
  assert.deepEqual(admins.accounts.map((account) => account.username), ['FirstCandidate']);

  assert.equal((await helixRequest('/api/data/admin-notes', firstCandidate)).statusCode, 200);
  identity.currentUser = firstCandidate;
  const elevatedSession = await accountRequest('/api/account/session/current', 'GET', undefined, identity);
  assert.equal((await elevatedSession.json()).account.role, 'admin');

  identity.currentUser = ownerUser;
  const demoteResponse = await accountRequest(
    `/api/account/admins/${admins.accounts[0].id}/demote`,
    'POST',
    {},
    identity,
  );
  assert.equal(demoteResponse.status, 200);
  assert.equal((await helixRequest('/api/data/admin-notes', firstCandidate)).statusCode, 401);

  identity.currentUser = firstCandidate;
  const demotedSession = await accountRequest('/api/account/session/current', 'GET', undefined, identity);
  assert.equal((await demotedSession.json()).account.role, 'user');
});

test('legacy email-bound admin links still promote one matching account and can be demoted', async () => {
  const ownerUser = createIdentityUser({
    id: 'identity-owner',
    email: 'owner@example.com',
    username: 'HelixOwner',
  });
  const adminUser = createIdentityUser({
    id: 'identity-admin',
    email: 'admin@example.com',
    username: 'AdminCandidate',
  });
  const identity = createFakeIdentity(ownerUser);
  await repository.syncAccountFromIdentity(ownerUser);
  await repository.syncAccountFromIdentity(adminUser);

  const inviteResponse = await accountRequest('/api/account/admin-invites', 'POST', {
    email: 'admin@example.com',
  }, identity);
  const invitation = await inviteResponse.json();
  const token = new URL(invitation.inviteLink).searchParams.get('admin_invite');

  assert.equal(inviteResponse.status, 201);
  assert.ok(token);
  assert.equal(invitation.emailDelivery, 'not_configured');

  identity.currentUser = adminUser;
  const acceptResponse = await accountRequest('/api/account/admin-invites/accept', 'POST', { token }, identity);
  assert.equal(acceptResponse.status, 200);
  assert.equal((await acceptResponse.json()).account.role, 'admin');

  identity.currentUser = ownerUser;
  const adminsResponse = await accountRequest('/api/account/admins', 'GET', undefined, identity);
  const admins = await adminsResponse.json();
  assert.equal(admins.accounts.length, 1);

  const demoteResponse = await accountRequest(
    `/api/account/admins/${admins.accounts[0].id}/demote`,
    'POST',
    {},
    identity,
  );
  assert.equal((await demoteResponse.json()).account.role, 'user');

  const accountsResponse = await accountRequest('/api/account/accounts', 'GET', undefined, identity);
  const accounts = await accountsResponse.json();
  assert.deepEqual(accounts.accounts.map((account) => account.username), ['AdminCandidate']);

  identity.admin.deleteUser = async () => {
    throw new Error('Admin operations require an operator token (only available in Netlify Functions)');
  };
  const localForceDeleteResponse = await accountRequest(
    `/api/account/accounts/${accounts.accounts[0].id}`,
    'DELETE',
    undefined,
    identity,
  );
  assert.equal(localForceDeleteResponse.status, 409);
  assert.match((await localForceDeleteResponse.json()).error, /Deploy Preview/i);
  assert.notEqual(await repository.getAccountByIdentityUserId('identity-admin'), null);

  identity.admin.deleteUser = async (id) => {
    identity.adminDeletedIds.push(id);
  };

  const forceDeleteResponse = await accountRequest(
    `/api/account/accounts/${accounts.accounts[0].id}`,
    'DELETE',
    undefined,
    identity,
  );
  assert.equal(forceDeleteResponse.status, 200);
  assert.deepEqual(identity.adminDeletedIds, ['identity-admin']);
  assert.equal(await repository.getAccountByIdentityUserId('identity-admin'), null);

  const ownerDeleteResponse = await accountRequest(
    `/api/account/accounts/${(await repository.getAccountByIdentityUserId('identity-owner')).id}`,
    'DELETE',
    undefined,
    identity,
  );
  assert.equal(ownerDeleteResponse.status, 404);

  const ownerSelfDeleteResponse = await accountRequest(
    '/api/account/deletion/request',
    'POST',
    { confirm: true },
    identity,
  );
  assert.equal(ownerSelfDeleteResponse.status, 403);
  assert.match((await ownerSelfDeleteResponse.json()).error, /owner account cannot be deleted/i);
});

test('configured admin invitations are sent through the Netlify email handler with preview cookies', async () => {
  const ownerUser = createIdentityUser({
    id: 'identity-email-owner',
    email: 'owner@example.com',
    username: 'EmailOwner',
  });
  const identity = createFakeIdentity(ownerUser);
  await repository.syncAccountFromIdentity(ownerUser);

  const originalFetch = globalThis.fetch;
  let emailRequest;

  process.env.HELIX_ADMIN_INVITE_FROM = 'accounts@helix.test';
  process.env.NETLIFY_EMAILS_SECRET = 'test-email-handler-secret';
  process.env.NETLIFY_PREVIEW_SERVER = 'true';
  process.env.SITE_NAME = 'helix-group-testing';
  const previewOrigin = 'https://devserver-feat-user-accounts--helix-group-testing.netlify.app';
  globalThis.fetch = async (url, options) => {
    emailRequest = { url: String(url), options };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const response = await accountRequest(
      '/api/account/admin-invites',
      'POST',
      { email: 'new-admin@example.com' },
      identity,
      'nf_preview_auth=preview-cookie',
      {
        requestBaseUrl: 'http://localhost:8888',
        requestOrigin: previewOrigin,
      },
    );
    const body = await response.json();
    const emailBody = JSON.parse(emailRequest.options.body);

    assert.equal(response.status, 201);
    assert.equal(body.emailDelivery, 'sent');
    assert.equal(emailRequest.url, `${previewOrigin}/.netlify/functions/emails/admin-invite`);
    assert.equal(emailRequest.options.headers.cookie, 'nf_preview_auth=preview-cookie');
    assert.equal(emailBody.to, 'new-admin@example.com');
    assert.equal(emailBody.from, 'accounts@helix.test');
    assert.equal(emailBody.parameters.inviteLink, body.inviteLink);
    assert.equal(new URL(body.inviteLink).origin, previewOrigin);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.HELIX_ADMIN_INVITE_FROM;
    delete process.env.NETLIFY_EMAILS_SECRET;
    delete process.env.NETLIFY_PREVIEW_SERVER;
    delete process.env.SITE_NAME;
  }
});

test('Postgres roles authorize existing admin APIs while users and pending accounts fail closed', async () => {
  const ownerUser = createIdentityUser({
    id: 'identity-owner',
    email: 'owner@example.com',
    username: 'HelixOwner',
  });
  const user = createIdentityUser({
    id: 'identity-user',
    email: 'user@example.com',
    username: 'RegularUser',
  });
  const ownerAccount = (await repository.syncAccountFromIdentity(ownerUser)).account;
  const userAccount = (await repository.syncAccountFromIdentity(user)).account;

  const denied = await helixRequest('/api/data/admin-notes', user);
  assert.equal(denied.statusCode, 401);

  const ownerAllowed = await helixRequest('/api/data/admin-notes', ownerUser);
  assert.equal(ownerAllowed.statusCode, 200);

  const crossOriginWrite = await helixRequest('/api/admin/data/admin-notes', ownerUser, {
    method: 'POST',
    bodyText: JSON.stringify([]),
    identityOriginVerified: false,
  });
  assert.equal(crossOriginWrite.statusCode, 403);

  await repository.requestAccountDeletion(ownerAccount.id);
  const pendingDenied = await helixRequest('/api/data/admin-notes', ownerUser);
  assert.equal(pendingDenied.statusCode, 401);
  assert.equal((await repository.getAccountById(userAccount.id)).role, 'user');
});

test('sensitive deletion requires reauthentication, supports cancellation, and cleanup retries safely', async () => {
  const user = createIdentityUser({
    id: 'identity-delete',
    email: 'delete@example.com',
    username: 'DeleteMe',
    lastSignInAt: '2026-07-17T12:00:00.000Z',
  });
  const identity = createFakeIdentity(user);
  const account = (await repository.syncAccountFromIdentity(user, {
    now: '2026-07-01T00:00:00.000Z',
  })).account;

  const withoutRecentAuth = await accountRequest('/api/account/deletion/request', 'POST', {
    confirm: true,
  }, identity);
  assert.equal(withoutRecentAuth.status, 401);

  const reauthResponse = await accountRequest('/api/account/reauth/email', 'POST', {
    password: 'correct-password',
  }, identity);
  assert.equal(reauthResponse.status, 200);
  const recentCookie = getCookiePair(reauthResponse.headers.get('set-cookie'), 'helix_recent_account_auth');
  assert.ok(recentCookie);

  const withoutConfirmation = await accountRequest('/api/account/deletion/request', 'POST', {}, identity, recentCookie);
  assert.equal(withoutConfirmation.status, 400);

  const deletionResponse = await accountRequest('/api/account/deletion/request', 'POST', {
    confirm: true,
  }, identity, recentCookie);
  assert.equal(deletionResponse.status, 202);
  assert.equal((await repository.getAccountById(account.id)).status, 'deletion_pending');

  identity.currentUser = user;
  const cancelResponse = await accountRequest('/api/account/deletion/cancel', 'POST', {}, identity);
  assert.equal(cancelResponse.status, 200);
  assert.equal((await cancelResponse.json()).account.status, 'active');

  await repository.requestAccountDeletion(account.id, '2026-07-01T00:00:00.000Z');
  const deletedIdentityIds = [];
  const cleanup = await runAccountDeletionCleanup({
    now: '2026-07-08T00:00:00.000Z',
    admin: {
      async deleteUser(identityUserId) {
        deletedIdentityIds.push(identityUserId);
      },
    },
  });

  assert.equal(cleanup.deleted, 1);
  assert.deepEqual(deletedIdentityIds, ['identity-delete']);
  assert.equal(await repository.getAccountByIdentityUserId('identity-delete'), null);
  assert.equal((await runAccountDeletionCleanup({
    now: '2026-07-08T01:00:00.000Z',
    admin: { async deleteUser() {} },
  })).due, 0);
});

test('failed Identity deletion leaves the due account for a later retry', async () => {
  const user = createIdentityUser({
    id: 'identity-retry-delete',
    email: 'retry-delete@example.com',
    username: 'RetryDelete',
  });
  const account = (await repository.syncAccountFromIdentity(user)).account;
  await repository.requestAccountDeletion(account.id, '2026-07-01T00:00:00.000Z');

  const failed = await runAccountDeletionCleanup({
    now: '2026-07-08T00:00:00.000Z',
    admin: {
      async deleteUser() {
        throw new Error('temporary Identity outage');
      },
    },
  });

  assert.equal(failed.failed, 1);
  assert.equal(await repository.getAccountByIdentityUserId(user.id) !== null, true);

  const retried = await runAccountDeletionCleanup({
    now: '2026-07-08T01:00:00.000Z',
    admin: { async deleteUser() {} },
  });
  assert.equal(retried.deleted, 1);
  assert.equal(await repository.getAccountByIdentityUserId(user.id), null);
});

function createFakeIdentity(initialUser = null) {
  const fakeIdentity = {
    currentUser: initialUser,
    signupCalls: [],
    adminUpdates: [],
    adminDeletedIds: [],
    admin: {
      async updateUser(id, attributes) {
        fakeIdentity.adminUpdates.push({ id, attributes });
      },
      async deleteUser(id) {
        fakeIdentity.adminDeletedIds.push(id);
      },
    },
    async getUser() {
      return this.currentUser;
    },
    async login(email, password) {
      if (password !== 'correct-password') {
        const error = new Error('invalid credentials');
        error.status = 401;
        throw error;
      }

      if (!this.currentUser || this.currentUser.email !== email) {
        this.currentUser = createIdentityUser({
          id: 'logged-in-user',
          email,
          username: undefined,
        });
      }

      return this.currentUser;
    },
    async logout() {
      this.currentUser = null;
    },
    async requestPasswordRecovery() {},
    async signup(email, password, data) {
      this.signupCalls.push({ email, password, data });
      return {
        id: 'signed-up-user',
        email,
        provider: 'email',
        userMetadata: data,
      };
    },
    verifyRequestOrigin(request, options) {
      const origin = request.headers.get('origin');
      const allowedOrigins = options?.allowedOrigins ?? [new URL(request.url).origin];

      if (!allowedOrigins.includes(origin)) {
        const error = new Error('Origin not allowed.');
        error.status = 403;
        throw error;
      }
    },
  };

  return fakeIdentity;
}

function createIdentityUser({
  id,
  email,
  username,
  provider = 'email',
  lastSignInAt = '2026-07-17T00:00:00.000Z',
}) {
  return {
    id,
    email,
    confirmedAt: '2026-07-01T00:00:00.000Z',
    lastSignInAt,
    provider,
    userMetadata: username === undefined ? {} : { helix_username: username },
  };
}

async function accountRequest(pathname, method, body, identity, cookie = '', options = {}) {
  const requestOrigin = options.requestOrigin ?? 'https://helix.test';
  const requestBaseUrl = options.requestBaseUrl ?? 'https://helix.test';
  const headers = new Headers({ origin: requestOrigin });

  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  if (cookie) {
    headers.set('cookie', cookie);
  }

  return handleAccountRequest(new Request(`${requestBaseUrl}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), identity);
}

function restoreEnvironment(previousEnvironment) {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function helixRequest(pathname, identityUser, overrides = {}) {
  return handleHelixApiRequest({
    method: overrides.method ?? 'GET',
    pathname,
    url: pathname,
    headers: {},
    bodyText: overrides.bodyText ?? '',
    identityUser,
    identityOriginVerified: overrides.identityOriginVerified,
  });
}

function getCookiePair(setCookieHeader, name) {
  return String(setCookieHeader ?? '')
    .split(/,(?=\s*[^;,=]+=[^;,]+)/)
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.split(';')[0] ?? '';
}
