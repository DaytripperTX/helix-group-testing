import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { NetlifyDB } from '@netlify/database-dev';
import * as repository from '../server/helix-account-postgres.mjs';

const migrationsDirectory = new URL('../netlify/database/migrations/', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const database = new NetlifyDB({ logger: () => {} });

before(async () => {
  process.env.NETLIFY_DB_URL = await database.start();
  process.env.NETLIFY_DB_DRIVER = 'server';
  process.env.HELIX_OWNER_EMAIL = 'owner@example.com';
  repository.resetAccountDatabaseClientForTests();
});

beforeEach(async () => {
  await repository.closeAccountDatabaseClientForTests();
  await database.reset();
  const applied = await database.applyMigrations(migrationsDirectory);

  assert.deepEqual(applied, [
    '20260714000100_create-label-storage',
    '20260717000100_create-user-accounts',
  ]);
});

after(async () => {
  await repository.closeAccountDatabaseClientForTests();
  await database.stop();
  delete process.env.NETLIFY_DB_URL;
  delete process.env.NETLIFY_DB_DRIVER;
  delete process.env.HELIX_OWNER_EMAIL;
});

test('verified Identity profiles bootstrap one owner and enforce normalized usernames', async () => {
  const ownerResult = await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-owner',
    email: 'Owner@Example.com',
    username: 'HelixChad',
  }));

  assert.equal(ownerResult.onboardingRequired, false);
  assert.equal(ownerResult.account.role, 'owner');
  assert.equal(ownerResult.account.email, 'Owner@Example.com');

  const regularResult = await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-user-one',
    email: 'user-one@example.com',
    username: 'Member_One',
  }));

  assert.equal(regularResult.account.role, 'user');

  const duplicateResult = await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-user-two',
    email: 'user-two@example.com',
    username: 'member_one',
  }));

  assert.equal(duplicateResult.account, null);
  assert.equal(duplicateResult.onboardingRequired, true);
  assert.equal(duplicateResult.usernameError, 'That username is already taken.');

  await assert.rejects(
    repository.syncAccountFromIdentity(createIdentityUser({
      id: 'identity-owner-two',
      email: 'owner@example.com',
      username: 'AnotherOwner',
    })),
    (error) => error.statusCode === 409 && /owner account/i.test(error.message),
  );
});

test('Netlify runtime database configuration is not replaced by the raw process connection value', async () => {
  const runtimeConnectionString = process.env.NETLIFY_DB_URL;
  const runtimeDriver = process.env.NETLIFY_DB_DRIVER;
  const originalNetlify = globalThis.Netlify;

  try {
    process.env.NETLIFY_DB_URL = 'postgres://preview.invalid/database';
    globalThis.Netlify = {
      env: {
        get(name) {
          if (name === 'NETLIFY_DB_URL') {
            return runtimeConnectionString;
          }

          if (name === 'NETLIFY_DB_DRIVER') {
            return runtimeDriver;
          }

          return undefined;
        },
      },
    };
    repository.resetAccountDatabaseClientForTests();

    const client = repository.getAccountDatabase();
    assert.equal(client.connectionString, runtimeConnectionString);
    assert.equal((await client.sql`SELECT 1 AS value`)[0].value, 1);
  } finally {
    await repository.closeAccountDatabaseClientForTests();
    process.env.NETLIFY_DB_URL = runtimeConnectionString;

    if (originalNetlify === undefined) {
      delete globalThis.Netlify;
    } else {
      globalThis.Netlify = originalNetlify;
    }
  }
});

test('profile completion and username updates enforce validation and uniqueness', async () => {
  const missingUsername = await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'google-user',
    email: 'google@example.com',
    username: undefined,
    provider: 'google',
  }));

  assert.equal(missingUsername.onboardingRequired, true);
  assert.equal(await repository.getAccountByIdentityUserId('google-user'), null);

  const completed = await repository.syncAccountFromIdentity(
    createIdentityUser({
      id: 'google-user',
      email: 'google@example.com',
      username: undefined,
      provider: 'google',
    }),
    { username: 'Google_User' },
  );

  assert.equal(completed.account.username, 'Google_User');

  const second = await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'second-user',
    email: 'second@example.com',
    username: 'SecondUser',
  }));

  const renamed = await repository.updateAccountUsername(completed.account.id, 'Updated-User');
  assert.equal(renamed.username, 'Updated-User');

  await assert.rejects(
    repository.updateAccountUsername(second.account.id, 'updated-user'),
    (error) => error.statusCode === 409,
  );
  await assert.rejects(
    repository.updateAccountUsername(second.account.id, 'owner'),
    (error) => error.statusCode === 400 && /reserved/i.test(error.message),
  );
});

test('admin invitations are email-bound, hashed, transactional, revocable, and one-time', async () => {
  const owner = (await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-owner',
    email: 'owner@example.com',
    username: 'AccountOwner',
  }))).account;
  const recipient = (await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-admin',
    email: 'admin@example.com',
    username: 'FutureAdmin',
  }))).account;
  const wrongRecipient = (await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-wrong',
    email: 'wrong@example.com',
    username: 'WrongUser',
  }))).account;
  const created = await repository.createAdminInvite(owner.id, 'Admin@Example.com');

  assert.equal(created.invite.recipientEmail, 'Admin@Example.com');
  assert.ok(created.token.length >= 40);

  const rawRows = await repository.getAccountDatabase().sql`SELECT token_hash FROM admin_invites`;
  assert.equal(rawRows[0].token_hash, repository.hashAdminInviteToken(created.token));
  assert.notEqual(rawRows[0].token_hash, created.token);

  await assert.rejects(
    repository.acceptAdminInvite(wrongRecipient.id, created.token),
    (error) => error.statusCode === 403 && /email/i.test(error.message),
  );

  const [firstAcceptance, replay] = await Promise.allSettled([
    repository.acceptAdminInvite(recipient.id, created.token),
    repository.acceptAdminInvite(recipient.id, created.token),
  ]);

  assert.equal(firstAcceptance.status, 'fulfilled');
  assert.equal(firstAcceptance.value.account.role, 'admin');
  assert.equal(replay.status, 'rejected');
  assert.equal(replay.reason.statusCode, 404);

  const admins = await repository.listAdminAccounts(owner.id);
  assert.deepEqual(admins.map((account) => account.username), ['FutureAdmin']);
  assert.deepEqual(
    (await repository.listOwnerManagedAccounts(owner.id)).map((account) => account.username),
    ['FutureAdmin', 'WrongUser'],
  );
  assert.equal((await repository.getOwnerManagedAccount(owner.id, recipient.id)).identityUserId, 'identity-admin');
  await assert.rejects(
    repository.getOwnerManagedAccount(owner.id, owner.id),
    (error) => error.statusCode === 404,
  );
  assert.equal((await repository.demoteAdminAccount(owner.id, recipient.id)).role, 'user');

  const revocable = await repository.createAdminInvite(owner.id, 'another@example.com');
  assert.ok((await repository.revokeAdminInvite(owner.id, revocable.invite.id)).revokedAt);
  await assert.rejects(
    repository.acceptAdminInvite(recipient.id, revocable.token),
    (error) => error.statusCode === 404,
  );

  const expired = await repository.createAdminInvite(
    owner.id,
    'admin@example.com',
    '2026-07-01T00:00:00.000Z',
  );
  await assert.rejects(
    repository.acceptAdminInvite(recipient.id, expired.token, '2026-07-08T00:00:00.001Z'),
    (error) => error.statusCode === 410 && /expired/i.test(error.message),
  );
});

test('seven-day deletion removes elevated access, can be cancelled, and purges due account data', async () => {
  const owner = (await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-owner',
    email: 'owner@example.com',
    username: 'AccountOwner',
  }))).account;
  const admin = (await repository.syncAccountFromIdentity(createIdentityUser({
    id: 'identity-admin',
    email: 'admin@example.com',
    username: 'DeleteMe',
  }))).account;
  const invite = await repository.createAdminInvite(owner.id, 'admin@example.com', '2026-07-01T00:00:00.000Z');
  await repository.acceptAdminInvite(admin.id, invite.token, '2026-07-01T01:00:00.000Z');

  const pending = await repository.requestAccountDeletion(admin.id, '2026-07-02T00:00:00.000Z');
  assert.equal(pending.status, 'deletion_pending');
  assert.equal(pending.role, 'admin');
  assert.equal((await repository.listAdminAccounts(owner.id)).length, 1);

  const cancelled = await repository.cancelAccountDeletion(admin.id, '2026-07-03T00:00:00.000Z');
  assert.equal(cancelled.status, 'active');
  assert.equal(cancelled.deletionScheduledFor, undefined);

  await repository.requestAccountDeletion(admin.id, '2026-07-04T00:00:00.000Z');
  assert.equal((await repository.listDueAccountDeletions('2026-07-10T23:59:59.000Z')).length, 0);
  assert.deepEqual(
    (await repository.listDueAccountDeletions('2026-07-11T00:00:00.000Z')).map((account) => account.id),
    [admin.id],
  );

  assert.equal(await repository.deleteAccountByIdentityUserId('identity-admin'), true);
  assert.equal(await repository.deleteAccountByIdentityUserId('identity-admin'), false);
  assert.equal(await repository.getAccountByIdentityUserId('identity-admin'), null);
  assert.equal((await repository.listAdminInvites(owner.id)).length, 0);
});

function createIdentityUser({ id, email, username, provider = 'email' }) {
  return {
    id,
    email,
    confirmedAt: '2026-07-01T00:00:00.000Z',
    provider,
    userMetadata: username === undefined ? {} : { helix_username: username },
  };
}
