export type IdentityCallbackType = 'oauth' | 'confirmation' | 'recovery' | 'invite' | 'email_change';

export function hasIdentityCallbackHash(hash?: string): boolean;
