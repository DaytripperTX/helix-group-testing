import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const adminCookieName = 'helix_admin_session';

const sessionMaxAgeSeconds = 60 * 60 * 12;
const localAdminPassword = 'helix-admin';
const localOwnerPassword = 'helix-owner';

export function getAdminSession(headers = {}) {
  const token = getCookie(headers, adminCookieName);

  if (!token) {
    return null;
  }

  const payload = verifySessionToken(token);

  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    role: payload.role === 'admin' ? 'admin' : 'owner',
  };
}

export function validateRolePassword(password, role = 'admin') {
  const configuredPassword = getConfiguredPasswordForRole(role);

  if (!configuredPassword || typeof password !== 'string') {
    return false;
  }

  return timingSafeStringEqual(password, configuredPassword);
}

export function createAdminSessionCookie(role = 'admin') {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds;
  const token = signSessionToken({
    role: role === 'owner' ? 'owner' : 'admin',
    exp: expiresAt,
    nonce: randomBytes(12).toString('hex'),
  });

  return serializeCookie(adminCookieName, token, {
    httpOnly: true,
    maxAge: sessionMaxAgeSeconds,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(),
    path: '/',
  });
}

export function createLogoutCookie() {
  return serializeCookie(adminCookieName, '', {
    httpOnly: true,
    maxAge: 0,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(),
    path: '/',
  });
}

export function getPublicSession(session) {
  return session
    ? {
        isAuthenticated: true,
        role: session.role,
      }
    : {
        isAuthenticated: false,
      };
}

function signSessionToken(payload) {
  const payloadText = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadText);
  const signature = signText(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token) {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature || !timingSafeStringEqual(signature, signText(encodedPayload))) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }
}

function signText(value) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function getSessionSecret() {
  return (
    process.env.HELIX_ADMIN_SESSION_SECRET ||
    process.env.HELIX_OWNER_PASSWORD ||
    process.env.HELIX_ADMIN_PASSWORD ||
    'local-helix-admin-session-secret'
  );
}

function getConfiguredPasswordForRole(role) {
  if (role === 'owner') {
    if (process.env.HELIX_OWNER_PASSWORD) {
      return process.env.HELIX_OWNER_PASSWORD;
    }

    return process.env.NETLIFY === 'true' ? '' : localOwnerPassword;
  }

  if (process.env.HELIX_ADMIN_PASSWORD) {
    return process.env.HELIX_ADMIN_PASSWORD;
  }

  return process.env.NETLIFY === 'true' ? '' : localAdminPassword;
}

function timingSafeStringEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

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

  for (const [headerName, value] of Object.entries(headers)) {
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

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}
