import './helix-env.mjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const adminCookieName = 'helix_admin_session';
export const coaRoundAccessCookieName = 'helix_coa_round_access';

const sessionMaxAgeSeconds = 60 * 60 * 12;
const coaRoundAccessMaxAgeSeconds = 60 * 60 * 24 * 365 * 10;
const ephemeralLocalSessionSecret = randomBytes(32).toString('base64url');

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

export function getCoaRoundAccess(headers = {}) {
  const token = getCookie(headers, coaRoundAccessCookieName);

  if (!token) {
    return {};
  }

  const payload = verifySessionToken(token);

  if (!payload || payload.exp < Math.floor(Date.now() / 1000) || !payload.rounds || typeof payload.rounds !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload.rounds)
      .filter(([roundId, fingerprint]) => (
        typeof roundId === 'string'
        && typeof fingerprint === 'string'
        && roundId.length > 0
        && fingerprint.length > 0
      )),
  );
}

export function createCoaRoundAccessCookie(roundAccess = {}) {
  const expiresAt = Math.floor(Date.now() / 1000) + coaRoundAccessMaxAgeSeconds;
  const token = signSessionToken({
    exp: expiresAt,
    rounds: Object.fromEntries(
      Object.entries(roundAccess)
        .filter(([roundId, fingerprint]) => (
          typeof roundId === 'string'
          && typeof fingerprint === 'string'
          && roundId.length > 0
          && fingerprint.length > 0
        )),
    ),
  });

  return serializeCookie(coaRoundAccessCookieName, token, {
    httpOnly: true,
    maxAge: coaRoundAccessMaxAgeSeconds,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(),
    path: '/',
  });
}

export function getCoaRoundPasscodeFingerprint(round) {
  const passcode = getRoundResultPasscode(round);

  return passcode
    ? signText(`coa-round:${round.id}:${passcode}`).slice(0, 32)
    : '';
}

export function hasCoaRoundAccess(round, roundAccess = {}) {
  const passcode = getRoundResultPasscode(round);

  if (!passcode) {
    return true;
  }

  return roundAccess?.[round.id] === getCoaRoundPasscodeFingerprint(round);
}

export function validateCoaRoundPasscode(round, passcode) {
  const configuredPasscode = getRoundResultPasscode(round);

  if (!configuredPasscode || typeof passcode !== 'string') {
    return false;
  }

  return timingSafeStringEqual(passcode.trim(), configuredPasscode);
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
  if (process.env.HELIX_ADMIN_SESSION_SECRET) {
    return process.env.HELIX_ADMIN_SESSION_SECRET;
  }

  if (isLocalDefaultsAllowed()) {
    return ephemeralLocalSessionSecret;
  }

  throw new Error('HELIX_ADMIN_SESSION_SECRET is required for admin sessions.');
}

function getRoundResultPasscode(round) {
  return typeof round?.resultPasscode === 'string' ? round.resultPasscode.trim() : '';
}

function getConfiguredPasswordForRole(role) {
  if (role === 'owner') {
    return process.env.HELIX_OWNER_PASSWORD ?? '';
  }

  return process.env.HELIX_ADMIN_PASSWORD ?? '';
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

function isLocalDefaultsAllowed() {
  return (
    process.env.HELIX_ALLOW_LOCAL_DEFAULTS === 'true' &&
    process.env.NETLIFY !== 'true' &&
    process.env.NODE_ENV !== 'production'
  );
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}
