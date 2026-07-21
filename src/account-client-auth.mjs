export function getIdentityAuthorizationHeader(cookieValue = '') {
  const token = String(cookieValue)
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('nf_jwt='))
    ?.slice('nf_jwt='.length);

  if (!token) {
    return '';
  }

  try {
    return `Bearer ${decodeURIComponent(token)}`;
  } catch {
    return `Bearer ${token}`;
  }
}

export function createIdentityRequestHeaders(initialHeaders, cookieValue) {
  const headers = new Headers(initialHeaders);
  const browserCookies = cookieValue ?? (
    typeof document === 'undefined' ? '' : document.cookie
  );
  const authorization = getIdentityAuthorizationHeader(browserCookies);

  if (authorization && !headers.has('authorization')) {
    headers.set('authorization', authorization);
  }

  return headers;
}
