import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getDatabase } from '@netlify/database';

export const ACCOUNT_DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const reservedUsernames = new Set([
  'admin',
  'administrator',
  'helix',
  'helixgroup',
  'moderator',
  'owner',
  'staff',
  'support',
  'system',
]);

let cachedDatabase;
let cachedConnectionString;

export function getAccountDatabase() {
  const connectionString = process.env.HELIX_DATABASE_URL || process.env.NETLIFY_DB_URL || '';

  if (!cachedDatabase || connectionString !== cachedConnectionString) {
    cachedConnectionString = connectionString;
    cachedDatabase = getDatabase(connectionString ? { connectionString } : undefined);
  }

  return cachedDatabase;
}

export function resetAccountDatabaseClientForTests() {
  cachedDatabase = undefined;
  cachedConnectionString = undefined;
}

export async function closeAccountDatabaseClientForTests() {
  const database = cachedDatabase;

  resetAccountDatabaseClientForTests();
  await database?.pool?.end();
}

export function normalizeAccountEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateAccountUsername(value) {
  const username = String(value ?? '').trim();

  if (username.length < 3 || username.length > 30) {
    return { ok: false, reason: 'Username must be between 3 and 30 characters.' };
  }

  if (!/^[A-Za-z0-9_-]+$/.test(username)) {
    return { ok: false, reason: 'Username can use letters, numbers, underscores, and hyphens.' };
  }

  const normalized = username.toLowerCase();

  if (reservedUsernames.has(normalized)) {
    return { ok: false, reason: 'That username is reserved.' };
  }

  return { ok: true, username, normalized };
}

export function hashAdminInviteToken(token) {
  return createHash('sha256').update(String(token ?? '')).digest('hex');
}

export async function getAccountByIdentityUserId(identityUserId) {
  if (!identityUserId) {
    return null;
  }

  const database = getAccountDatabase();
  const [row] = await database.sql`
    SELECT *
    FROM accounts
    WHERE identity_user_id = ${identityUserId}
    LIMIT 1
  `;

  return row ? toAccount(row) : null;
}

export async function getAccountById(accountId) {
  if (!accountId) {
    return null;
  }

  const database = getAccountDatabase();
  const [row] = await database.sql`
    SELECT *
    FROM accounts
    WHERE id = ${accountId}
    LIMIT 1
  `;

  return row ? toAccount(row) : null;
}

export async function isAccountUsernameAvailable(value, excludedAccountId = null) {
  const validation = validateAccountUsername(value);

  if (!validation.ok) {
    return false;
  }

  const database = getAccountDatabase();
  const rows = excludedAccountId
    ? await database.sql`
        SELECT 1
        FROM accounts
        WHERE username_normalized = ${validation.normalized}
          AND id <> ${excludedAccountId}
        LIMIT 1
      `
    : await database.sql`
        SELECT 1
        FROM accounts
        WHERE username_normalized = ${validation.normalized}
        LIMIT 1
      `;

  return rows.length === 0;
}

export async function syncAccountFromIdentity(identityUser, options = {}) {
  const identityUserId = String(identityUser?.id ?? '').trim();
  const email = String(identityUser?.email ?? '').trim();
  const emailNormalized = normalizeAccountEmail(email);
  const verifiedAt = toIsoString(identityUser?.confirmedAt);
  const now = toIsoString(options.now) ?? new Date().toISOString();

  if (!identityUserId || !emailNormalized || !emailNormalized.includes('@') || !verifiedAt) {
    throw createAccountError(403, 'A verified Identity account is required.');
  }

  const preferredUsername = options.username
    ?? identityUser?.userMetadata?.helix_username
    ?? identityUser?.userMetadata?.username;
  const usernameValidation = validateAccountUsername(preferredUsername);
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE');

    const existingResult = await client.query(
      'SELECT * FROM accounts WHERE identity_user_id = $1 FOR UPDATE',
      [identityUserId],
    );
    const existing = existingResult.rows[0];

    if (existing) {
      const updatedResult = await client.query(
        `UPDATE accounts
         SET email = $2,
             email_normalized = $3,
             email_verified_at = $4,
             last_login_at = $5,
             updated_at = $5
         WHERE id = $1
         RETURNING *`,
        [existing.id, email, emailNormalized, verifiedAt, now],
      );

      await client.query('COMMIT');
      return { account: toAccount(updatedResult.rows[0]), onboardingRequired: false };
    }

    if (!usernameValidation.ok) {
      await client.query('ROLLBACK');
      return {
        account: null,
        onboardingRequired: true,
        usernameError: usernameValidation.reason,
      };
    }

    const duplicateUsername = await client.query(
      'SELECT 1 FROM accounts WHERE username_normalized = $1 LIMIT 1',
      [usernameValidation.normalized],
    );

    if (duplicateUsername.rowCount > 0) {
      await client.query('ROLLBACK');
      return {
        account: null,
        onboardingRequired: true,
        usernameError: 'That username is already taken.',
      };
    }

    const configuredOwnerEmail = normalizeAccountEmail(process.env.HELIX_OWNER_EMAIL);
    let role = 'user';

    if (configuredOwnerEmail && emailNormalized === configuredOwnerEmail) {
      const ownerResult = await client.query(
        "SELECT identity_user_id FROM accounts WHERE role = 'owner' LIMIT 1",
      );

      if (ownerResult.rowCount > 0) {
        throw createAccountError(409, 'The owner account has already been configured.');
      }

      role = 'owner';
    }

    const insertedResult = await client.query(
      `INSERT INTO accounts (
         id,
         identity_user_id,
         email,
         email_normalized,
         username,
         username_normalized,
         role,
         status,
         email_verified_at,
         last_login_at,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $9, $9)
       RETURNING *`,
      [
        randomUUID(),
        identityUserId,
        email,
        emailNormalized,
        usernameValidation.username,
        usernameValidation.normalized,
        role,
        verifiedAt,
        now,
      ],
    );

    await client.query('COMMIT');
    return { account: toAccount(insertedResult.rows[0]), onboardingRequired: false };
  } catch (error) {
    await rollbackQuietly(client);

    if (error?.code === '23505' && String(error?.constraint ?? '').includes('username')) {
      return {
        account: null,
        onboardingRequired: true,
        usernameError: 'That username is already taken.',
      };
    }

    if (error?.code === '23505' && String(error?.constraint ?? '').includes('email')) {
      throw createAccountError(409, 'That email is already linked to another account.');
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function updateAccountUsername(accountId, value, now = new Date().toISOString()) {
  const validation = validateAccountUsername(value);

  if (!validation.ok) {
    throw createAccountError(400, validation.reason);
  }

  const database = getAccountDatabase();

  try {
    const [row] = await database.sql`
      UPDATE accounts
      SET username = ${validation.username},
          username_normalized = ${validation.normalized},
          updated_at = ${now}
      WHERE id = ${accountId}
        AND status = 'active'
      RETURNING *
    `;

    if (!row) {
      throw createAccountError(404, 'Active account not found.');
    }

    return toAccount(row);
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      throw createAccountError(409, 'That username is already taken.');
    }

    throw error;
  }
}

export async function createAdminInvite(ownerAccountId, recipientEmail, now = new Date().toISOString()) {
  const email = String(recipientEmail ?? '').trim();
  const emailNormalized = normalizeAccountEmail(email);

  if (!emailNormalized || !emailNormalized.includes('@') || email.length > 320) {
    throw createAccountError(400, 'A valid recipient email is required.');
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashAdminInviteToken(token);
  const expiresAt = new Date(new Date(now).getTime() + ADMIN_INVITE_LIFETIME_MS).toISOString();
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await assertOwnerAccount(client, ownerAccountId);
    await client.query(
      `UPDATE admin_invites
       SET revoked_at = $2
       WHERE recipient_email_normalized = $1
         AND consumed_at IS NULL
         AND revoked_at IS NULL`,
      [emailNormalized, now],
    );
    const result = await client.query(
      `INSERT INTO admin_invites (
         id,
         token_hash,
         recipient_email,
         recipient_email_normalized,
         role,
         created_by_account_id,
         created_at,
         expires_at
       ) VALUES ($1, $2, $3, $4, 'admin', $5, $6, $7)
       RETURNING *`,
      [randomUUID(), tokenHash, email, emailNormalized, ownerAccountId, now, expiresAt],
    );
    await client.query('COMMIT');

    return { invite: toAdminInvite(result.rows[0]), token };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function listAdminInvites(ownerAccountId) {
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await assertOwnerAccount(client, ownerAccountId);
    const result = await client.query(
      `SELECT *
       FROM admin_invites
       ORDER BY created_at DESC, id`,
    );

    return result.rows.map(toAdminInvite);
  } finally {
    client.release();
  }
}

export async function revokeAdminInvite(ownerAccountId, inviteId, now = new Date().toISOString()) {
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await assertOwnerAccount(client, ownerAccountId);
    const result = await client.query(
      `UPDATE admin_invites
       SET revoked_at = $3
       WHERE id = $1
         AND created_by_account_id = $2
         AND consumed_at IS NULL
         AND revoked_at IS NULL
       RETURNING *`,
      [inviteId, ownerAccountId, now],
    );

    if (!result.rows[0]) {
      throw createAccountError(404, 'Active invitation not found.');
    }

    await client.query('COMMIT');
    return toAdminInvite(result.rows[0]);
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function acceptAdminInvite(accountId, token, now = new Date().toISOString()) {
  const tokenHash = hashAdminInviteToken(token);
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    const accountResult = await client.query(
      'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
      [accountId],
    );
    const account = accountResult.rows[0];

    if (!account || account.status !== 'active') {
      throw createAccountError(403, 'An active account is required.');
    }

    const inviteResult = await client.query(
      'SELECT * FROM admin_invites WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
    );
    const invite = inviteResult.rows[0];

    if (!invite || invite.consumed_at || invite.revoked_at) {
      throw createAccountError(404, 'Invitation is invalid or has already been used.');
    }

    if (new Date(invite.expires_at).getTime() <= new Date(now).getTime()) {
      throw createAccountError(410, 'Invitation has expired.');
    }

    if (invite.recipient_email_normalized !== account.email_normalized) {
      throw createAccountError(403, 'Invitation email does not match this account.');
    }

    const updatedAccountResult = account.role === 'owner'
      ? accountResult
      : await client.query(
          `UPDATE accounts
           SET role = 'admin', updated_at = $2
           WHERE id = $1
           RETURNING *`,
          [accountId, now],
        );
    const consumedInviteResult = await client.query(
      `UPDATE admin_invites
       SET consumed_by_account_id = $2,
           consumed_at = $3
       WHERE id = $1
       RETURNING *`,
      [invite.id, accountId, now],
    );

    await client.query('COMMIT');
    return {
      account: toAccount(updatedAccountResult.rows[0]),
      invite: toAdminInvite(consumedInviteResult.rows[0]),
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function listAdminAccounts(ownerAccountId) {
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await assertOwnerAccount(client, ownerAccountId);
    const result = await client.query(
      `SELECT *
       FROM accounts
       WHERE role = 'admin'
       ORDER BY username_normalized, id`,
    );

    return result.rows.map(toAccount);
  } finally {
    client.release();
  }
}

export async function demoteAdminAccount(ownerAccountId, adminAccountId, now = new Date().toISOString()) {
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await assertOwnerAccount(client, ownerAccountId);
    const result = await client.query(
      `UPDATE accounts
       SET role = 'user', updated_at = $3
       WHERE id = $1
         AND role = 'admin'
         AND id <> $2
       RETURNING *`,
      [adminAccountId, ownerAccountId, now],
    );

    if (!result.rows[0]) {
      throw createAccountError(404, 'Admin account not found.');
    }

    await client.query('COMMIT');
    return toAccount(result.rows[0]);
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function requestAccountDeletion(accountId, now = new Date().toISOString()) {
  const scheduledFor = new Date(new Date(now).getTime() + ACCOUNT_DELETION_GRACE_MS).toISOString();
  const database = getAccountDatabase();
  const [row] = await database.sql`
    UPDATE accounts
    SET status = 'deletion_pending',
        deletion_requested_at = ${now},
        deletion_scheduled_for = ${scheduledFor},
        updated_at = ${now}
    WHERE id = ${accountId}
      AND status = 'active'
    RETURNING *
  `;

  if (!row) {
    throw createAccountError(404, 'Active account not found.');
  }

  return toAccount(row);
}

export async function cancelAccountDeletion(accountId, now = new Date().toISOString()) {
  const database = getAccountDatabase();
  const [row] = await database.sql`
    UPDATE accounts
    SET status = 'active',
        deletion_requested_at = NULL,
        deletion_scheduled_for = NULL,
        updated_at = ${now}
    WHERE id = ${accountId}
      AND status = 'deletion_pending'
      AND deletion_scheduled_for > ${now}
    RETURNING *
  `;

  if (!row) {
    throw createAccountError(404, 'Pending account deletion not found.');
  }

  return toAccount(row);
}

export async function listDueAccountDeletions(now = new Date().toISOString(), limit = 50) {
  const database = getAccountDatabase();
  const rows = await database.sql`
    SELECT *
    FROM accounts
    WHERE status = 'deletion_pending'
      AND deletion_scheduled_for <= ${now}
    ORDER BY deletion_scheduled_for, id
    LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 100))}
  `;

  return rows.map(toAccount);
}

export async function deleteAccountByIdentityUserId(identityUserId) {
  const database = getAccountDatabase();
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    const accountResult = await client.query(
      'SELECT * FROM accounts WHERE identity_user_id = $1 FOR UPDATE',
      [identityUserId],
    );
    const account = accountResult.rows[0];

    if (!account) {
      await client.query('COMMIT');
      return false;
    }

    await client.query(
      `DELETE FROM admin_invites
       WHERE recipient_email_normalized = $1
          OR consumed_by_account_id = $2`,
      [account.email_normalized, account.id],
    );
    await client.query('DELETE FROM accounts WHERE id = $1', [account.id]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function toAccount(row) {
  return {
    id: row.id,
    identityUserId: row.identity_user_id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    emailVerifiedAt: toIsoString(row.email_verified_at),
    lastLoginAt: toIsoString(row.last_login_at),
    deletionRequestedAt: toIsoString(row.deletion_requested_at),
    deletionScheduledFor: toIsoString(row.deletion_scheduled_for),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toAdminInvite(row) {
  return {
    id: row.id,
    recipientEmail: row.recipient_email,
    role: row.role,
    createdByAccountId: row.created_by_account_id ?? undefined,
    consumedByAccountId: row.consumed_by_account_id ?? undefined,
    createdAt: toIsoString(row.created_at),
    expiresAt: toIsoString(row.expires_at),
    consumedAt: toIsoString(row.consumed_at),
    revokedAt: toIsoString(row.revoked_at),
  };
}

async function assertOwnerAccount(client, accountId) {
  const result = await client.query(
    `SELECT id
     FROM accounts
     WHERE id = $1
       AND role = 'owner'
       AND status = 'active'
     LIMIT 1`,
    [accountId],
  );

  if (result.rowCount === 0) {
    throw createAccountError(403, 'Owner account required.');
  }
}

function toIsoString(value) {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The original transaction error is more useful.
  }
}

function createAccountError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getPostgresErrorCode(error) {
  let currentError = error;

  while (currentError) {
    if (currentError.code) {
      return String(currentError.code);
    }

    currentError = currentError.cause;
  }

  return '';
}
