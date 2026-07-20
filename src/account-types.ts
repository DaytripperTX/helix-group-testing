export type AccountRole = 'user' | 'admin' | 'owner';
export type AccountStatus = 'active' | 'deletion_pending';

export type AccountRecord = {
  id: string;
  username: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  deletionScheduledFor?: string;
};

export type AccountSession = {
  isAuthenticated: boolean;
  onboardingRequired?: boolean;
  usernameError?: string;
  legacyAuthEnabled?: boolean;
  identity?: {
    id: string;
    email?: string;
    provider?: 'google' | 'github' | 'gitlab' | 'bitbucket' | 'facebook' | 'email';
    confirmedAt?: string;
    lastSignInAt?: string;
  };
  account?: AccountRecord;
};

export type IdentityCallbackNotice = {
  type?: 'oauth' | 'confirmation' | 'recovery' | 'invite' | 'email_change';
  error?: string;
};

export const signedOutAccountSession: AccountSession = {
  isAuthenticated: false,
};
