import { getAdminSession } from './helix-auth.mjs';
import {
  getAccountByIdentityUserId,
  syncAccountFromIdentity,
} from './helix-account-postgres.mjs';

export async function resolveAccountSession(identityUser, options = {}) {
  if (!identityUser) {
    return { isAuthenticated: false };
  }

  const result = options.sync === false
    ? {
        account: await getAccountByIdentityUserId(identityUser.id),
        onboardingRequired: false,
      }
    : await syncAccountFromIdentity(identityUser, {
        username: options.username,
        now: options.now,
      });

  if (!result.account) {
    return {
      isAuthenticated: true,
      onboardingRequired: true,
      usernameError: result.usernameError,
      identity: toPublicIdentity(identityUser),
    };
  }

  return {
    isAuthenticated: true,
    onboardingRequired: false,
    identity: toPublicIdentity(identityUser),
    account: toPublicAccount(result.account),
  };
}

export async function resolveAdminSession({ identityUser, headers }) {
  if (identityUser?.id) {
    try {
      const account = await getAccountByIdentityUserId(identityUser.id);

      if (account?.status === 'deletion_pending') {
        return null;
      }

      if (account?.status === 'active' && (account.role === 'admin' || account.role === 'owner')) {
        return {
          role: account.role,
          accountId: account.id,
          username: account.username,
          source: 'account',
        };
      }
    } catch (error) {
      console.error('[helix-account-auth] account role lookup failed', {
        message: error?.message,
      });
      return null;
    }
  }

  const legacySession = getAdminSession(headers);

  return legacySession
    ? { ...legacySession, source: 'legacy' }
    : null;
}

export function toPublicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    role: account.role,
    status: account.status,
    ...(account.deletionScheduledFor
      ? { deletionScheduledFor: account.deletionScheduledFor }
      : {}),
  };
}

function toPublicIdentity(identityUser) {
  return {
    id: identityUser.id,
    email: identityUser.email,
    provider: identityUser.provider,
    confirmedAt: identityUser.confirmedAt,
    lastSignInAt: identityUser.lastSignInAt,
  };
}
