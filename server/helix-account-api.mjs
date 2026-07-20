import {
  admin as identityAdmin,
  getUser as getIdentityUser,
  login as identityLogin,
  logout as identityLogout,
  requestPasswordRecovery,
  signup as identitySignup,
  verifyRequestOrigin,
} from '@netlify/identity';
import {
  acceptAdminInvite,
  cancelAccountDeletion,
  createAdminInvite,
  deleteAccountByIdentityUserId,
  demoteAdminAccount,
  getOwnerManagedAccount,
  isAccountUsernameAvailable,
  listAdminAccounts,
  listAdminInvites,
  listOwnerManagedAccounts,
  requestAccountDeletion,
  revokeAdminInvite,
  syncAccountFromIdentity,
  updateAccountUsername,
  validateAccountUsername,
} from './helix-account-postgres.mjs';
import { resolveAccountSession, toPublicAccount } from './helix-account-auth.mjs';
import {
  createClearRecentAccountAuthCookie,
  createRecentAccountAuthCookie,
  hasRecentAccountAuthentication,
} from './helix-account-security.mjs';
import {
  createLogoutCookie as createLegacyLogoutCookie,
  isLegacyAdminAuthEnabled,
} from './helix-auth.mjs';
import {
  getHelixPublicRequestOrigin,
  verifyHelixRequestOrigin,
} from './helix-request-origin.mjs';

const maxAccountBodyBytes = 16 * 1024;
const recentGoogleLoginMs = 10 * 60 * 1000;

const defaultIdentityServices = {
  admin: identityAdmin,
  getUser: getIdentityUser,
  login: identityLogin,
  logout: identityLogout,
  requestPasswordRecovery,
  signup: identitySignup,
  verifyRequestOrigin,
};

export async function handleAccountRequest(request, identity = defaultIdentityServices) {
  const method = request.method.toUpperCase();
  const requestUrl = new URL(request.url);
  const pathname = normalizeAccountPath(requestUrl.pathname);

  try {
    if (method === 'GET' && pathname === '/api/account/session') {
      const user = await identity.getUser();
      const session = user
        ? await resolveAccountSession(user)
        : { isAuthenticated: false };

      return accountJsonResponse(200, {
        ...session,
        legacyAuthEnabled: isLegacyAdminAuthEnabled(),
      });
    }

    if (method === 'POST' && pathname === '/api/account/signup') {
      assertRequestOrigin(request, identity);
      const body = await readJsonBody(request);
      const usernameValidation = validateAccountUsername(body?.username);

      if (!usernameValidation.ok) {
        throw createAccountApiError(400, usernameValidation.reason);
      }

      if (!await isAccountUsernameAvailable(usernameValidation.username)) {
        throw createAccountApiError(409, 'That username is already taken.');
      }

      const user = await identity.signup(
        String(body?.email ?? '').trim(),
        String(body?.password ?? ''),
        { helix_username: usernameValidation.username },
      );
      const session = user?.confirmedAt
        ? await resolveAccountSession(user, { username: usernameValidation.username })
        : null;

      return accountJsonResponse(session?.account ? 200 : 202, session?.account
        ? session
        : {
            ok: true,
            requiresConfirmation: true,
            message: 'Check your email to confirm your account.',
          });
    }

    if (method === 'POST' && pathname === '/api/account/login') {
      assertRequestOrigin(request, identity);
      const body = await readJsonBody(request);
      let user;

      try {
        user = await identity.login(
          String(body?.email ?? '').trim(),
          String(body?.password ?? ''),
        );
      } catch (error) {
        throw createAccountApiError(401, 'Invalid email or password.', error);
      }

      return accountJsonResponse(200, await resolveAccountSession(user));
    }

    if (method === 'POST' && pathname === '/api/account/logout') {
      assertRequestOrigin(request, identity);

      try {
        await identity.logout();
      } finally {
        return accountJsonResponse(200, { ok: true }, {
          cookies: [
            createClearRecentAccountAuthCookie(),
            createLegacyLogoutCookie(),
          ],
        });
      }
    }

    if (method === 'POST' && pathname === '/api/account/password-recovery') {
      assertRequestOrigin(request, identity);
      const body = await readJsonBody(request);

      try {
        await identity.requestPasswordRecovery(String(body?.email ?? '').trim());
      } catch {
        // Always return the same response so this endpoint cannot enumerate accounts.
      }

      return accountJsonResponse(200, {
        ok: true,
        message: 'If that email has an account, a recovery link is on the way.',
      });
    }

    if (method === 'POST' && pathname === '/api/account/complete-profile') {
      assertRequestOrigin(request, identity);
      const user = await requireIdentityUser(identity);
      const body = await readJsonBody(request);
      const result = await syncAccountFromIdentity(user, { username: body?.username });

      if (!result.account) {
        throw createAccountApiError(409, result.usernameError ?? 'A username is required.');
      }

      await updateIdentityUsername(identity, user, result.account.username);
      return accountJsonResponse(200, {
        isAuthenticated: true,
        onboardingRequired: false,
        account: toPublicAccount(result.account),
      });
    }

    if (method === 'PUT' && pathname === '/api/account/profile/username') {
      assertRequestOrigin(request, identity);
      const { user, account } = await requireActiveAccount(identity);
      const body = await readJsonBody(request);
      const updated = await updateAccountUsername(account.id, body?.username);

      await updateIdentityUsername(identity, user, updated.username);
      return accountJsonResponse(200, { account: toPublicAccount(updated) });
    }

    if (method === 'POST' && pathname === '/api/account/reauth/email') {
      assertRequestOrigin(request, identity);
      const currentUser = await requireIdentityUser(identity);
      const session = await resolveAccountSession(currentUser, { sync: false });

      if (!session.account || session.account.status !== 'active') {
        throw createAccountApiError(403, 'An active account is required.');
      }

      const body = await readJsonBody(request);
      let authenticatedUser;

      try {
        authenticatedUser = await identity.login(
          session.account.email,
          String(body?.password ?? ''),
        );
      } catch (error) {
        throw createAccountApiError(401, 'Password was not recognized.', error);
      }

      if (authenticatedUser?.id !== currentUser.id) {
        throw createAccountApiError(403, 'Reauthentication did not match this account.');
      }

      return accountJsonResponse(200, { ok: true }, {
        cookies: [createRecentAccountAuthCookie(currentUser.id)],
      });
    }

    if (method === 'POST' && pathname === '/api/account/reauth/google') {
      assertRequestOrigin(request, identity);
      const user = await requireIdentityUser(identity);
      const provider = user.provider ?? user.appMetadata?.provider;
      const lastSignInAt = new Date(user.lastSignInAt ?? 0).getTime();

      if (
        provider !== 'google'
        || !Number.isFinite(lastSignInAt)
        || Date.now() - lastSignInAt > recentGoogleLoginMs
      ) {
        throw createAccountApiError(401, 'Sign in with Google again to continue.');
      }

      return accountJsonResponse(200, { ok: true }, {
        cookies: [createRecentAccountAuthCookie(user.id)],
      });
    }

    if (method === 'POST' && pathname === '/api/account/deletion/request') {
      assertRequestOrigin(request, identity);
      const { user, account } = await requireActiveAccount(identity);
      const body = await readJsonBody(request);

      if (account.role === 'owner') {
        throw createAccountApiError(403, 'The owner account cannot be deleted.');
      }

      if (!hasRecentAccountAuthentication(request.headers, user.id)) {
        throw createAccountApiError(401, 'Recent authentication is required.');
      }

      if (body?.confirm !== true) {
        throw createAccountApiError(400, 'Confirm account deletion to continue.');
      }

      const pendingAccount = await requestAccountDeletion(account.id);

      try {
        await identity.logout();
      } catch {
        // Identity clears auth cookies even when its remote logout call fails.
      }

      return accountJsonResponse(202, {
        ok: true,
        deletionScheduledFor: pendingAccount.deletionScheduledFor,
      }, {
        cookies: [
          createClearRecentAccountAuthCookie(),
          createLegacyLogoutCookie(),
        ],
      });
    }

    if (method === 'POST' && pathname === '/api/account/deletion/cancel') {
      assertRequestOrigin(request, identity);
      const user = await requireIdentityUser(identity);
      const session = await resolveAccountSession(user, { sync: false });

      if (!session.account || session.account.status !== 'deletion_pending') {
        throw createAccountApiError(404, 'Pending account deletion not found.');
      }

      const account = await cancelAccountDeletion(session.account.id);
      return accountJsonResponse(200, {
        isAuthenticated: true,
        onboardingRequired: false,
        account: toPublicAccount(account),
      });
    }

    if (method === 'POST' && pathname === '/api/account/admin-invites/accept') {
      assertRequestOrigin(request, identity);
      const { account } = await requireActiveAccount(identity);
      const body = await readJsonBody(request);
      const accepted = await acceptAdminInvite(account.id, body?.token);

      return accountJsonResponse(200, { account: toPublicAccount(accepted.account) });
    }

    if (pathname === '/api/account/admin-invites') {
      const { account } = await requireOwnerAccount(identity);

      if (method === 'GET') {
        return accountJsonResponse(200, { invites: await listAdminInvites(account.id) });
      }

      if (method === 'POST') {
        assertRequestOrigin(request, identity);
        const body = await readJsonBody(request);
        const created = await createAdminInvite(account.id, body?.email);
        const publicOrigin = getHelixPublicRequestOrigin(request);
        const inviteLink = `${publicOrigin}/account?admin_invite=${encodeURIComponent(created.token)}`;
        const emailDelivery = await sendAdminInviteEmail({
          request,
          recipientEmail: created.invite.recipientEmail,
          inviteLink,
        });

        return accountJsonResponse(201, {
          invite: created.invite,
          inviteLink,
          emailDelivery,
        });
      }
    }

    if (method === 'DELETE' && pathname.startsWith('/api/account/admin-invites/')) {
      assertRequestOrigin(request, identity);
      const { account } = await requireOwnerAccount(identity);
      const inviteId = decodeURIComponent(pathname.slice('/api/account/admin-invites/'.length));

      return accountJsonResponse(200, {
        invite: await revokeAdminInvite(account.id, inviteId),
      });
    }

    if (method === 'GET' && pathname === '/api/account/admins') {
      const { account } = await requireOwnerAccount(identity);
      return accountJsonResponse(200, { accounts: await listAdminAccounts(account.id) });
    }

    if (method === 'GET' && pathname === '/api/account/accounts') {
      const { account } = await requireOwnerAccount(identity);
      return accountJsonResponse(200, { accounts: await listOwnerManagedAccounts(account.id) });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/account/accounts/')) {
      assertRequestOrigin(request, identity);
      const { account: ownerAccount } = await requireOwnerAccount(identity);
      const managedAccountId = decodeURIComponent(pathname.slice('/api/account/accounts/'.length));
      const managedAccount = await getOwnerManagedAccount(ownerAccount.id, managedAccountId);

      if (!identity.admin?.deleteUser) {
        throw createAccountApiError(503, 'Identity account deletion is unavailable.');
      }

      try {
        await identity.admin.deleteUser(managedAccount.identityUserId);
      } catch (error) {
        if (isMissingIdentityOperatorTokenError(error)) {
          throw createAccountApiError(
            409,
            'Force deletion must be run from a Netlify Deploy Preview or production site; Netlify Dev does not provide the Identity operator token.',
            error,
          );
        }

        if (!isIdentityNotFoundError(error)) {
          throw createAccountApiError(502, 'Identity account could not be deleted.', error);
        }
      }

      await deleteAccountByIdentityUserId(managedAccount.identityUserId);
      return accountJsonResponse(200, {
        ok: true,
        account: toPublicAccount(managedAccount),
      });
    }

    if (method === 'POST' && pathname.startsWith('/api/account/admins/') && pathname.endsWith('/demote')) {
      assertRequestOrigin(request, identity);
      const { account } = await requireOwnerAccount(identity);
      const adminAccountId = decodeURIComponent(
        pathname.slice('/api/account/admins/'.length, -'/demote'.length),
      );

      return accountJsonResponse(200, {
        account: toPublicAccount(await demoteAdminAccount(account.id, adminAccountId)),
      });
    }

    return accountJsonResponse(404, { error: 'Unknown account endpoint.' });
  } catch (error) {
    const statusCode = Number(error?.statusCode ?? error?.status) || 500;
    const message = statusCode >= 500 ? 'Account service error.' : error.message;

    if (statusCode >= 500) {
      console.error('[helix-account-api] request failed', {
        method,
        pathname,
        message: error?.message,
        cause: error?.cause?.message,
        stack: error?.stack,
      });
    }

    return accountJsonResponse(statusCode, { error: message });
  }
}

async function requireIdentityUser(identity) {
  const user = await identity.getUser();

  if (!user) {
    throw createAccountApiError(401, 'Sign in required.');
  }

  return user;
}

async function requireActiveAccount(identity) {
  const user = await requireIdentityUser(identity);
  const session = await resolveAccountSession(user, { sync: false });

  if (!session.account || session.account.status !== 'active') {
    throw createAccountApiError(403, 'An active account is required.');
  }

  return { user, account: session.account };
}

async function requireOwnerAccount(identity) {
  const result = await requireActiveAccount(identity);

  if (result.account.role !== 'owner') {
    throw createAccountApiError(403, 'Owner account required.');
  }

  return result;
}

async function updateIdentityUsername(identity, user, username) {
  if (!identity.admin?.updateUser) {
    return;
  }

  try {
    await identity.admin.updateUser(user.id, {
      user_metadata: {
        ...(user.userMetadata ?? {}),
        helix_username: username,
      },
    });
  } catch (error) {
    console.warn('[helix-account-api] Identity username metadata sync failed', {
      identityUserId: user.id,
      message: error?.message,
    });
  }
}

async function sendAdminInviteEmail({ request, recipientEmail, inviteLink }) {
  const emailSecret = String(process.env.NETLIFY_EMAILS_SECRET ?? '').trim();
  const from = String(process.env.HELIX_ADMIN_INVITE_FROM ?? '').trim();

  if (!emailSecret || !from) {
    return 'not_configured';
  }

  const emailOrigin = getHelixPublicRequestOrigin(request);
  const cookie = request.headers.get('cookie');

  try {
    const response = await fetch(`${emailOrigin}/.netlify/functions/emails/admin-invite`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'netlify-emails-secret': emailSecret,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        from,
        to: recipientEmail,
        subject: 'Your Helix admin invitation',
        parameters: {
          inviteLink,
          recipientEmail,
        },
      }),
    });

    if (!response.ok) {
      console.warn('[helix-account-api] admin invitation email failed', {
        recipientEmail,
        status: response.status,
      });
      return 'failed';
    }

    return 'sent';
  } catch (error) {
    console.warn('[helix-account-api] admin invitation email failed', {
      recipientEmail,
      message: error?.message,
    });
    return 'failed';
  }
}

function isIdentityNotFoundError(error) {
  return Number(error?.statusCode ?? error?.status) === 404;
}

function isMissingIdentityOperatorTokenError(error) {
  return /operator token/i.test(String(error?.message ?? ''));
}

function assertRequestOrigin(request, identity) {
  verifyHelixRequestOrigin(request, identity.verifyRequestOrigin);
}

async function readJsonBody(request) {
  const text = await request.text();

  if (Buffer.byteLength(text, 'utf8') > maxAccountBodyBytes) {
    throw createAccountApiError(413, 'Account request is too large.');
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw createAccountApiError(400, 'Invalid JSON body.', cause);
  }
}

function accountJsonResponse(statusCode, body, options = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
  });

  for (const cookie of options.cookies ?? []) {
    headers.append('Set-Cookie', cookie);
  }

  return new Response(JSON.stringify(body), { status: statusCode, headers });
}

function normalizeAccountPath(pathname) {
  if (pathname.startsWith('/.netlify/functions/account')) {
    return pathname.replace('/.netlify/functions/account', '/api/account');
  }

  return pathname;
}

function createAccountApiError(statusCode, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.statusCode = statusCode;
  return error;
}
