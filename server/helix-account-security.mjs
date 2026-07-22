import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const recentAccountAuthCookieName = 'helix_recent_account_auth';

const recentAuthMaxAgeSeconds = 10 * 60;
const ephemeralLocalActionSecret = randomBytes(32).toString('base64url');

export function createRecentAccountAuthCookie(identityUserId, now = Date.now()) {
  const issuedAt = Math.floor(new Date(now).getTime() / 1000);
  const payload = {
    sub: String(identityUserId ?? ''),
    iat: issuedAt,
    exp: issuedAt + recentAuthMaxAgeSeconds,
    nonce: randomBytes(12).toString('hex'),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${encodedPayload}.${signRecentAuth(encodedPayload)}`;

  return serializeCookie(recentAccountAuthCookieName, token, {
    httpOnly: true,
    maxAge: recentAuthMaxAgeSeconds,
    sameSite: 'Strict',
    secure: shouldUseSecureCookies(),
    path: '/api/account',
  });
}

export function createClearRecentAccountAuthCookie() {
  return serializeCookie(recentAccountAuthCookieName, '', {
    httpOnly: true,
    maxAge: 0,
    sameSite: 'Strict',
    secure: shouldUseSecureCookies(),
    path: '/api/account',
  });
}

export function hasRecentAccountAuthentication(headers, identityUserId, now = Date.now()) {
  const token = getCookie(headers, recentAccountAuthCookieName);

  if (!token) {
    return false;
  }

  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature || !timingSafeStringEqual(signature, signRecentAuth(encodedPayload))) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const currentTime = Math.floor(new Date(now).getTime() / 1000);

    return (
      payload?.sub === String(identityUserId ?? '')
      && Number.isFinite(payload?.iat)
      && Number.isFinite(payload?.exp)
      && payload.iat <= currentTime
      && payload.exp >= currentTime
    );
  } catch {
    return false;
  }
}

function signRecentAuth(value) {
  return createHmac('sha256', getAccountActionSecret()).update(value).digest('base64url');
}

function getAccountActionSecret() {
  if (process.env.HELIX_ACCOUNT_ACTION_SECRET) {
    return process.env.HELIX_ACCOUNT_ACTION_SECRET;
  }

  if (isLocalDefaultsAllowed()) {
    return ephemeralLocalActionSecret;
  }

  throw new Error('HELIX_ACCOUNT_ACTION_SECRET is required for sensitive account actions.');
}

function timingSafeStringEqual(first, second) {
  const firstBuffer = Buffer.from(String(first ?? ''));
  const secondBuffer = Buffer.from(String(second ?? ''));

  if (firstBuffer.byteLength !== secondBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(firstBuffer, secondBuffer);
}

function getCookie(headers, name) {
  const cookieHeader = getHeader(headers, 'cookie');

  if (!cookieHeader) {
    return '';
  }

  return cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? '';
}

function getHeader(headers, name) {
  const normalizedName = name.toLowerCase();

  if (headers instanceof Headers) {
    return headers.get(name) ?? '';
  }

  for (const [headerName, value] of Object.entries(headers ?? {})) {
    if (headerName.toLowerCase() === normalizedName) {
      return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    }
  }

  return '';
}

function serializeCookie(name, value, options) {
  const cookieParts = [`${name}=${value}`, `Path=${options.path ?? '/'}`];

  if (typeof options.maxAge === 'number') {
    cookieParts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly) {
    cookieParts.push('HttpOnly');
  }

  if (options.secure) {
    cookieParts.push('Secure');
  }

  if (options.sameSite) {
    cookieParts.push(`SameSite=${options.sameSite}`);
  }

  return cookieParts.join('; ');
}

function shouldUseSecureCookies() {
  return process.env.NETLIFY === 'true' || process.env.HELIX_SECURE_COOKIES === 'true';
}

function isLocalDefaultsAllowed() {
  return (
    process.env.HELIX_ALLOW_LOCAL_DEFAULTS === 'true'
    && process.env.NETLIFY !== 'true'
    && process.env.NODE_ENV !== 'production'
  );
}
