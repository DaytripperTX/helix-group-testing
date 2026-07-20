const identityCallbackParameterNames = [
  'access_token',
  'confirmation_token',
  'recovery_token',
  'invite_token',
  'email_change_token',
];

export function hasIdentityCallbackHash(hash = '') {
  const value = String(hash).replace(/^#/, '');

  if (!value) {
    return false;
  }

  const parameters = new URLSearchParams(value);
  return identityCallbackParameterNames.some((name) => Boolean(parameters.get(name)));
}
