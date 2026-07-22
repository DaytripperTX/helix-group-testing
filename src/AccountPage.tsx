import { oauthLogin, updateUser } from '@netlify/identity';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { AccountRecord, AccountSession, IdentityCallbackNotice } from './account-types';

type AuthMode = 'signin' | 'signup' | 'recover' | 'reset';

type AdminAccessLink = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

type ManagedAccount = AccountRecord;

type AdminAccessRequest = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  reviewedAt?: string;
  account: ManagedAccount;
};

const inviteStorageKey = 'helix_admin_invite_token';
const adminRequestStorageKey = 'helix_admin_request_token';
const oauthIntentStorageKey = 'helix_oauth_intent';
const accountStatusDurationMs = 5_000;
const persistentAccountStatusMessages = new Set([
  'Check your email to confirm your account.',
  'Check your email for the confirmation link before signing in.',
]);

function AccountPage({
  session,
  identityCallbackNotice,
  onSessionChange,
  onRefreshSession,
  onNavigate,
}: {
  session: AccountSession;
  identityCallbackNotice: IdentityCallbackNotice | null;
  onSessionChange: (session: AccountSession) => void;
  onRefreshSession: () => Promise<AccountSession>;
  onNavigate: (path: string) => void;
}) {
  const callbackHandledRef = useRef(false);
  const inviteAcceptedRef = useRef('');
  const adminRequestSubmittedRef = useRef('');
  const [mode, setMode] = useState<AuthMode>(() => getInitialMode());
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryPasswordConfirmation, setRecoveryPasswordConfirmation] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecentAuthReady, setIsRecentAuthReady] = useState(false);
  const [scheduledDeletionDate, setScheduledDeletionDate] = useState('');
  const [adminAccessLinks, setAdminAccessLinks] = useState<AdminAccessLink[]>([]);
  const [adminAccessRequests, setAdminAccessRequests] = useState<AdminAccessRequest[]>([]);
  const [managedAdmins, setManagedAdmins] = useState<ManagedAccount[]>([]);
  const [managedAccounts, setManagedAccounts] = useState<ManagedAccount[]>([]);
  const [newAdminRequestLink, setNewAdminRequestLink] = useState('');
  const isLocalIdentityAdminUnavailable = ['localhost', '127.0.0.1', '[::1]', '::1']
    .includes(window.location.hostname);

  useEffect(() => {
    if (!status || persistentAccountStatusMessages.has(status)) {
      return;
    }

    const timeoutId = window.setTimeout(() => setStatus(''), accountStatusDurationMs);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const inviteToken = url.searchParams.get('admin_invite');
    const adminRequestToken = url.searchParams.get('admin_request');

    if (!inviteToken && !adminRequestToken) {
      return;
    }

    if (inviteToken) {
      window.localStorage.setItem(inviteStorageKey, inviteToken);
    }

    if (adminRequestToken) {
      window.localStorage.setItem(adminRequestStorageKey, adminRequestToken);
    }

    url.searchParams.delete('admin_invite');
    url.searchParams.delete('admin_request');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setStatus(adminRequestToken
      ? 'Sign in or create an account to request admin access.'
      : 'Sign in or create the invited account to accept admin access.');
  }, []);

  useEffect(() => {
    const syncModeFromUrl = () => {
      if (!session.isAuthenticated) {
        setMode(getInitialMode());
      }
    };

    window.addEventListener('popstate', syncModeFromUrl);
    return () => window.removeEventListener('popstate', syncModeFromUrl);
  }, [session.isAuthenticated]);

  useEffect(() => {
    if (callbackHandledRef.current || !identityCallbackNotice) {
      return;
    }

    callbackHandledRef.current = true;
    void (async () => {
      setIsSubmitting(true);

      try {
        if (identityCallbackNotice.error) {
          setStatus(identityCallbackNotice.error);
          return;
        }

        if (identityCallbackNotice.type === 'recovery') {
          setMode('reset');
          setStatus('Choose a new password.');
          return;
        }

        let resolvedSession = session;

        if (!resolvedSession.isAuthenticated) {
          resolvedSession = await onRefreshSession();
        }

        const oauthIntent = window.sessionStorage.getItem(oauthIntentStorageKey);

        if (oauthIntent === 'delete' && resolvedSession.identity?.provider === 'google') {
          await accountFetch('/api/account/reauth/google', { method: 'POST', body: {} });
          window.sessionStorage.removeItem(oauthIntentStorageKey);
          setIsRecentAuthReady(true);
          setStatus('Google sign-in verified. You can now delete your account.');
        } else {
          window.sessionStorage.removeItem(oauthIntentStorageKey);
          setStatus(resolvedSession.onboardingRequired
            ? 'Choose a username to finish setup.'
            : resolvedSession.isAuthenticated
              ? (identityCallbackNotice.type === 'confirmation'
                  ? 'Email confirmed. Signed in.'
                  : 'Signed in.')
              : 'Sign-in completed, but the account session could not be loaded. Refresh and try again.');
        }
      } catch (error) {
        setStatus(getErrorMessage(error, 'Authentication link could not be completed.'));
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [identityCallbackNotice, onRefreshSession, session]);

  useEffect(() => {
    const inviteToken = window.localStorage.getItem(inviteStorageKey) ?? '';

    if (
      !inviteToken
      || inviteAcceptedRef.current === inviteToken
      || !session.account
      || session.account.status !== 'active'
    ) {
      return;
    }

    inviteAcceptedRef.current = inviteToken;
    void (async () => {
      setIsSubmitting(true);

      try {
        const response = await accountFetch<{ account: AccountRecord }>('/api/account/admin-invites/accept', {
          method: 'POST',
          body: { token: inviteToken },
        });
        window.localStorage.removeItem(inviteStorageKey);
        onSessionChange({ ...session, account: response.account });
        setStatus('Admin invitation accepted.');
      } catch (error) {
        setStatus(getErrorMessage(error, 'Admin invitation could not be accepted.'));
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [onSessionChange, session]);

  useEffect(() => {
    const token = window.localStorage.getItem(adminRequestStorageKey) ?? '';

    if (
      !token
      || adminRequestSubmittedRef.current === token
      || !session.account
      || session.account.status !== 'active'
    ) {
      return;
    }

    adminRequestSubmittedRef.current = token;
    void (async () => {
      setIsSubmitting(true);

      try {
        await accountFetch('/api/account/admin-access-requests', {
          method: 'POST',
          body: { token },
        });
        window.localStorage.removeItem(adminRequestStorageKey);
        setStatus('Admin access request sent for owner approval.');
      } catch (error) {
        setStatus(getErrorMessage(error, 'Admin access request could not be sent.'));
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [session.account]);

  useEffect(() => {
    if (session.account?.role !== 'owner' || session.account.status !== 'active') {
      setAdminAccessLinks([]);
      setAdminAccessRequests([]);
      setManagedAdmins([]);
      setManagedAccounts([]);
      return;
    }

    void refreshOwnerData();
  }, [session.account?.id, session.account?.role, session.account?.status]);

  useEffect(() => {
    if (session.account?.role !== 'owner' || session.account.status !== 'active') {
      return;
    }

    let isActive = true;
    let isRefreshing = false;

    const refreshRequests = async () => {
      if (!isActive || isRefreshing) {
        return;
      }

      isRefreshing = true;

      try {
        const result = await accountFetch<{ requests: AdminAccessRequest[] }>(
          '/api/account/admin-access-requests',
        );

        if (isActive) {
          setAdminAccessRequests(result.requests);
        }
      } catch {
        // Keep the existing list during a transient background refresh failure.
      } finally {
        isRefreshing = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshRequests();
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    window.addEventListener('pageshow', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      isActive = false;
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      window.removeEventListener('pageshow', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [session.account?.id, session.account?.role, session.account?.status]);

  const refreshOwnerData = async () => {
    try {
      const [linkResult, requestResult, adminResult, accountResult] = await Promise.all([
        accountFetch<{ links: AdminAccessLink[] }>('/api/account/admin-access-links'),
        accountFetch<{ requests: AdminAccessRequest[] }>('/api/account/admin-access-requests'),
        accountFetch<{ accounts: ManagedAccount[] }>('/api/account/admins'),
        accountFetch<{ accounts: ManagedAccount[] }>('/api/account/accounts'),
      ]);
      setAdminAccessLinks(linkResult.links);
      setAdminAccessRequests(requestResult.requests);
      setManagedAdmins(adminResult.accounts);
      setManagedAccounts(accountResult.accounts);
    } catch (error) {
      setStatus(getErrorMessage(error, 'Admin account list could not be loaded.'));
    }
  };

  const submitSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setStatus('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setStatus('');

    try {
      const result = await accountFetch<AccountSession & { message?: string }>('/api/account/signup', {
        method: 'POST',
        body: { username, email, password },
      });

      if (result.account) {
        onSessionChange(result);
        setStatus('Account created.');
      } else {
        setStatus(result.message ?? 'Check your email to confirm your account.');
        setMode('signin');
      }

      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Account could not be created.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus('');

    try {
      const nextSession = await accountFetch<AccountSession>('/api/account/login', {
        method: 'POST',
        body: { email, password },
      });
      onSessionChange(nextSession);
      setPassword('');
      setStatus(nextSession.onboardingRequired ? 'Choose a username to finish setup.' : 'Signed in.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Sign in failed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus('');

    try {
      const result = await accountFetch<{ message: string }>('/api/account/password-recovery', {
        method: 'POST',
        body: { email },
      });
      setStatus(result.message);
    } catch (error) {
      setStatus(getErrorMessage(error, 'Recovery email could not be requested.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (recoveryPassword !== recoveryPasswordConfirmation) {
      setStatus('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      await updateUser({ password: recoveryPassword });
      await onRefreshSession();
      setRecoveryPassword('');
      setRecoveryPasswordConfirmation('');
      setStatus('Password updated.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Password could not be updated.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const completeProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const nextSession = await accountFetch<AccountSession>('/api/account/complete-profile', {
        method: 'POST',
        body: { username },
      });
      onSessionChange(nextSession);
      setStatus('Account setup complete.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Username could not be saved.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateUsername = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const result = await accountFetch<{ account: AccountRecord }>('/api/account/profile/username', {
        method: 'PUT',
        body: { username },
      });
      onSessionChange({ ...session, account: result.account });
      setUsername('');
      setStatus('Username updated.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Username could not be updated.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    setIsSubmitting(true);

    try {
      await accountFetch('/api/account/logout', { method: 'POST', body: {} });
      onSessionChange({ isAuthenticated: false, legacyAuthEnabled: session.legacyAuthEnabled });
      setMode('signin');
      setStatus('Signed out.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Sign out failed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const startGoogle = (intent: 'login' | 'delete' = 'login') => {
    window.sessionStorage.setItem(oauthIntentStorageKey, intent);
    oauthLogin('google');
  };

  const verifyPasswordForDeletion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await accountFetch('/api/account/reauth/email', {
        method: 'POST',
        body: { password },
      });
      setPassword('');
      setIsRecentAuthReady(true);
      setStatus('Password verified. You can now delete your account.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Password was not recognized.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestDeletion = async () => {
    if (!window.confirm('Schedule this account for permanent deletion in seven days?')) {
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await accountFetch<{ deletionScheduledFor: string }>('/api/account/deletion/request', {
        method: 'POST',
        body: { confirm: true },
      });
      setScheduledDeletionDate(result.deletionScheduledFor);
      setIsRecentAuthReady(false);
      onSessionChange({ isAuthenticated: false, legacyAuthEnabled: session.legacyAuthEnabled });
    } catch (error) {
      setStatus(getErrorMessage(error, 'Account deletion could not be scheduled.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelDeletion = async () => {
    setIsSubmitting(true);

    try {
      const nextSession = await accountFetch<AccountSession>('/api/account/deletion/cancel', {
        method: 'POST',
        body: {},
      });
      onSessionChange(nextSession);
      setStatus('Account deletion cancelled.');
    } catch (error) {
      setStatus(getErrorMessage(error, 'Account deletion could not be cancelled.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const createAdminRequestLink = async () => {
    const hasActiveLink = adminAccessLinks.some((link) => (
      !link.revokedAt && new Date(link.expiresAt).getTime() > Date.now()
    ));

    if (hasActiveLink && !window.confirm('Replace the current admin request link? The old link will stop working.')) {
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await accountFetch<{
        link: AdminAccessLink;
        adminRequestLink: string;
      }>('/api/account/admin-access-links', {
        method: 'POST',
        body: {},
      });
      setNewAdminRequestLink(result.adminRequestLink);
      setStatus('Reusable admin request link created. Copy it now.');
      await refreshOwnerData();
    } catch (error) {
      setStatus(getErrorMessage(error, 'Admin request link could not be created.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const revokeAdminRequestLink = async (linkId: string) => {
    setIsSubmitting(true);

    try {
      await accountFetch(`/api/account/admin-access-links/${encodeURIComponent(linkId)}`, {
        method: 'DELETE',
      });
      setNewAdminRequestLink('');
      setStatus('Admin request link revoked.');
      await refreshOwnerData();
    } catch (error) {
      setStatus(getErrorMessage(error, 'Admin request link could not be revoked.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const reviewAdminRequest = async (requestId: string, decision: 'approve' | 'reject') => {
    setIsSubmitting(true);

    try {
      await accountFetch(`/api/account/admin-access-requests/${encodeURIComponent(requestId)}/${decision}`, {
        method: 'POST',
        body: {},
      });
      setStatus(decision === 'approve' ? 'Admin access approved.' : 'Admin access request rejected.');
      await refreshOwnerData();
    } catch (error) {
      setStatus(getErrorMessage(error, 'Admin access request could not be reviewed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const demoteAdmin = async (accountId: string) => {
    setIsSubmitting(true);

    try {
      await accountFetch(`/api/account/admins/${encodeURIComponent(accountId)}/demote`, {
        method: 'POST',
        body: {},
      });
      setStatus('Admin access removed.');
      await refreshOwnerData();
    } catch (error) {
      setStatus(getErrorMessage(error, 'Admin access could not be removed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const forceDeleteAccount = async (account: ManagedAccount) => {
    if (!window.confirm(`Permanently delete ${account.username} (${account.email}) now? This cannot be undone.`)) {
      return;
    }

    setIsSubmitting(true);

    try {
      await accountFetch(`/api/account/accounts/${encodeURIComponent(account.id)}`, {
        method: 'DELETE',
      });
      setStatus(`${account.username} was permanently deleted.`);
      await refreshOwnerData();
    } catch (error) {
      setStatus(getErrorMessage(error, 'Account could not be deleted.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (scheduledDeletionDate) {
    return (
      <AccountShell title="Deletion scheduled" eyebrow="Account">
        <p>Your account is scheduled for permanent deletion on {formatDateTime(scheduledDeletionDate)}.</p>
        <p>Sign in before then if you want to cancel.</p>
        <button
          type="button"
          onClick={() => {
            setScheduledDeletionDate('');
            setMode('signin');
          }}
        >
          Sign in
        </button>
      </AccountShell>
    );
  }

  if (!session.isAuthenticated) {
    return (
      <AccountShell title={getAuthTitle(mode)} eyebrow="Helix account">
        {mode === 'signin' && (
          <form className="account-form" onSubmit={submitLogin}>
            <AccountField label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} />
            <AccountField label="Password" type="password" value={password} autoComplete="current-password" onChange={setPassword} />
            <button type="submit" disabled={isSubmitting}>Sign in</button>
            <button className="account-google-button" type="button" disabled={isSubmitting} onClick={() => startGoogle()}>
              Continue with Google
            </button>
            <div className="account-form__links">
              <button type="button" onClick={() => setMode('signup')}>Create account</button>
              <button type="button" onClick={() => setMode('recover')}>Forgot password?</button>
            </div>
          </form>
        )}

        {mode === 'signup' && (
          <form className="account-form" onSubmit={submitSignup}>
            <AccountField label="Username" value={username} autoComplete="username" onChange={setUsername} />
            <AccountField label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} />
            <AccountField label="Password" type="password" value={password} autoComplete="new-password" onChange={setPassword} />
            <AccountField label="Confirm password" type="password" value={confirmPassword} autoComplete="new-password" onChange={setConfirmPassword} />
            <button type="submit" disabled={isSubmitting}>Create account</button>
            <button className="account-google-button" type="button" disabled={isSubmitting} onClick={() => startGoogle()}>
              Continue with Google
            </button>
            <div className="account-form__links">
              <button type="button" onClick={() => setMode('signin')}>Already have an account?</button>
            </div>
          </form>
        )}

        {mode === 'recover' && (
          <form className="account-form" onSubmit={submitRecovery}>
            <AccountField label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} />
            <button type="submit" disabled={isSubmitting}>Send recovery email</button>
            <div className="account-form__links">
              <button type="button" onClick={() => setMode('signin')}>Back to sign in</button>
            </div>
          </form>
        )}

        {mode === 'reset' && (
          <form className="account-form" onSubmit={submitPasswordReset}>
            <AccountField label="New password" type="password" value={recoveryPassword} autoComplete="new-password" onChange={setRecoveryPassword} />
            <AccountField label="Confirm password" type="password" value={recoveryPasswordConfirmation} autoComplete="new-password" onChange={setRecoveryPasswordConfirmation} />
            <button type="submit" disabled={isSubmitting}>Save password</button>
          </form>
        )}

        {status && <p className="account-status" role="status">{status}</p>}
      </AccountShell>
    );
  }

  if (session.onboardingRequired || !session.account) {
    return (
      <AccountShell title="Choose a username" eyebrow="Finish setup">
        <p>Usernames use 3-30 letters, numbers, underscores, or hyphens.</p>
        <form className="account-form" onSubmit={completeProfile}>
          <AccountField label="Username" value={username} autoComplete="username" onChange={setUsername} />
          <button type="submit" disabled={isSubmitting}>Finish setup</button>
        </form>
        <button className="account-text-button" type="button" onClick={signOut}>Sign out</button>
        {status && <p className="account-status" role="status">{status}</p>}
      </AccountShell>
    );
  }

  if (session.account.status === 'deletion_pending') {
    return (
      <AccountShell title="Deletion pending" eyebrow="Account">
        <p>Your account will be permanently deleted on {formatDateTime(session.account.deletionScheduledFor)}.</p>
        <div className="account-actions">
          <button type="button" disabled={isSubmitting} onClick={cancelDeletion}>Cancel deletion</button>
          <button className="account-text-button" type="button" disabled={isSubmitting} onClick={signOut}>Sign out</button>
        </div>
        {status && <p className="account-status" role="status">{status}</p>}
      </AccountShell>
    );
  }

  return (
    <section className="account-page" aria-labelledby="account-title">
      <div className="account-shell">
        <header className="account-shell__header">
          <div>
            <p className="eyebrow">Helix account</p>
            <h1 id="account-title">{session.account.username}</h1>
            <p>{session.account.email}</p>
          </div>
          <span className="account-role-badge">{session.account.role}</span>
        </header>

        {status && <p className="account-status" role="status">{status}</p>}

        <section className="account-card" aria-labelledby="username-settings-title">
          <h2 id="username-settings-title">Username</h2>
          <p>Current: <strong>{session.account.username}</strong></p>
          <form className="account-inline-form" onSubmit={updateUsername}>
            <AccountField label="New username" value={username} autoComplete="username" onChange={setUsername} />
            <button type="submit" disabled={isSubmitting || !username.trim()}>Update</button>
          </form>
        </section>

        {(session.account.role === 'admin' || session.account.role === 'owner') && (
          <section className="account-card account-card--admin" aria-labelledby="admin-access-title">
            <h2 id="admin-access-title">Admin access</h2>
            <p>Your account can access the Helix admin tools.</p>
            <button type="button" onClick={() => onNavigate(session.account?.role === 'owner' ? '/hxowner' : '/hxadmin')}>
              Open admin
            </button>
          </section>
        )}

        {session.account.role === 'owner' && (
          <section className="account-card account-card--owner" aria-labelledby="admin-accounts-title">
            <h2 id="admin-accounts-title">Admin accounts</h2>
            <p>
              Share one link with prospective admins. It only submits a request; you must approve each account below.
            </p>
            <button type="button" disabled={isSubmitting} onClick={createAdminRequestLink}>
              Create reusable link
            </button>

            {newAdminRequestLink && (
              <div className="account-invite-link">
                <label>
                  <span>Copy this link now</span>
                  <input readOnly value={newAdminRequestLink} onFocus={(event) => event.currentTarget.select()} />
                </label>
                <button type="button" onClick={() => void navigator.clipboard?.writeText(newAdminRequestLink)}>Copy</button>
              </div>
            )}

            <div className="account-management-grid">
              <div>
                <h3>Shared link</h3>
                {adminAccessLinks.every((link) => (
                  Boolean(link.revokedAt) || new Date(link.expiresAt).getTime() <= Date.now()
                )) && <p>No active admin request link.</p>}
                {adminAccessLinks.filter((link) => (
                  !link.revokedAt && new Date(link.expiresAt).getTime() > Date.now()
                )).map((link) => (
                  <article className="account-management-row" key={link.id}>
                    <div>
                      <strong>Reusable request link</strong>
                      <small>Expires {formatDateTime(link.expiresAt)}</small>
                    </div>
                    <button type="button" disabled={isSubmitting} onClick={() => revokeAdminRequestLink(link.id)}>Revoke</button>
                  </article>
                ))}
              </div>

              <div>
                <h3>Pending requests</h3>
                {adminAccessRequests.every((request) => request.status !== 'pending') && <p>No pending requests.</p>}
                {adminAccessRequests.filter((request) => request.status === 'pending').map((request) => (
                  <article className="account-management-row" key={request.id}>
                    <div>
                      <strong>{request.account.username}</strong>
                      <small>{request.account.email} · Requested {formatDateTime(request.requestedAt)}</small>
                    </div>
                    <div className="account-actions">
                      <button type="button" disabled={isSubmitting} onClick={() => reviewAdminRequest(request.id, 'approve')}>Approve</button>
                      <button type="button" disabled={isSubmitting} onClick={() => reviewAdminRequest(request.id, 'reject')}>Reject</button>
                    </div>
                  </article>
                ))}
              </div>

              <div>
                <h3>Admins</h3>
                {managedAdmins.length === 0 && <p>No admin accounts.</p>}
                {managedAdmins.map((admin) => (
                  <article className="account-management-row" key={admin.id}>
                    <div>
                      <strong>{admin.username}</strong>
                      <small>{admin.email}</small>
                    </div>
                    <button type="button" disabled={isSubmitting} onClick={() => demoteAdmin(admin.id)}>Remove admin</button>
                  </article>
                ))}
              </div>
            </div>

            <div className="account-managed-accounts">
              <h3>All accounts</h3>
              <p>Force delete removes both the Identity login and PostgreSQL account immediately.</p>
              {isLocalIdentityAdminUnavailable && (
                <p className="account-local-notice">
                  Force deletion must be tested on a Netlify Deploy Preview because Netlify Dev does not provide the Identity operator token.
                </p>
              )}
              {managedAccounts.length === 0 && <p>No other accounts.</p>}
              {managedAccounts.map((account) => (
                <article className="account-management-row" key={account.id}>
                  <div>
                    <strong>{account.username}</strong>
                    <small>{account.email} · {account.role} · {account.status.replace('_', ' ')}</small>
                  </div>
                  <button
                    className="account-management-row__danger"
                    type="button"
                    disabled={isSubmitting || isLocalIdentityAdminUnavailable}
                    title={isLocalIdentityAdminUnavailable ? 'Available on a Netlify Deploy Preview' : undefined}
                    onClick={() => forceDeleteAccount(account)}
                  >
                    Force delete
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {session.account.role !== 'owner' && (
          <section className="account-card account-card--danger" aria-labelledby="delete-account-title">
            <h2 id="delete-account-title">Delete account</h2>
            <p>Deletion removes account access now and becomes permanent after seven days.</p>

            {!isRecentAuthReady && session.identity?.provider === 'google' && (
              <button type="button" disabled={isSubmitting} onClick={() => startGoogle('delete')}>
                Verify with Google
              </button>
            )}

            {!isRecentAuthReady && session.identity?.provider !== 'google' && (
              <form className="account-inline-form" onSubmit={verifyPasswordForDeletion}>
                <AccountField label="Password" type="password" value={password} autoComplete="current-password" onChange={setPassword} />
                <button type="submit" disabled={isSubmitting || !password}>Verify password</button>
              </form>
            )}

            {isRecentAuthReady && (
              <button className="account-danger-button" type="button" disabled={isSubmitting} onClick={requestDeletion}>
                Schedule deletion
              </button>
            )}
          </section>
        )}

        <button className="account-signout-button" type="button" disabled={isSubmitting} onClick={signOut}>Sign out</button>
      </div>
    </section>
  );
}

function AccountShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="account-page account-page--centered" aria-labelledby="account-title">
      <div className="account-auth-card">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="account-title">{title}</h1>
        {children}
      </div>
    </section>
  );
}

function AccountField({
  label,
  type = 'text',
  value,
  autoComplete,
  onChange,
}: {
  label: string;
  type?: string;
  value: string;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="account-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        required
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

async function accountFetch<T = unknown>(url: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : 'Account request failed.');
  }

  return body as T;
}

function getInitialMode(): AuthMode {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'signup' || mode === 'recover' ? mode : 'signin';
}

function getAuthTitle(mode: AuthMode) {
  return {
    recover: 'Reset password',
    reset: 'Choose a password',
    signin: 'Sign in',
    signup: 'Create account',
  }[mode];
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'the scheduled date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default AccountPage;
