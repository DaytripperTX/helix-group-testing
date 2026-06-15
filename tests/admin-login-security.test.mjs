import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.HELIX_ADMIN_PASSWORD = 'test-admin-password';
process.env.HELIX_OWNER_PASSWORD = 'test-owner-password';
process.env.HELIX_ADMIN_SESSION_SECRET = 'test-admin-session-secret';

const { handleHelixApiRequest } = await import('../server/helix-api.mjs');

test('admin login locks out an IP and role after five incorrect attempts', async () => {
  const client = { ip: '203.0.113.44', userAgent: 'admin-login-lockout-test' };

  for (let index = 0; index < 5; index += 1) {
    const response = await login('admin', 'wrong-password', client);

    assert.equal(response.statusCode, 401);
  }

  const throttledWrongPassword = await login('admin', 'wrong-password', client);
  const throttledCorrectPassword = await login('admin', process.env.HELIX_ADMIN_PASSWORD, client);

  assert.equal(throttledWrongPassword.statusCode, 429);
  assert.equal(throttledCorrectPassword.statusCode, 429);
  assert.equal(JSON.parse(throttledCorrectPassword.body).error, 'Too many login attempts. Try again later.');
  assert.ok(Number(throttledCorrectPassword.headers['Retry-After']) > 0);
});

test('admin login lockout key is scoped by IP plus role', async () => {
  const lockedClient = { ip: '203.0.113.45', userAgent: 'admin-login-scope-test' };
  const otherClient = { ip: '203.0.113.46', userAgent: 'admin-login-scope-test' };

  for (let index = 0; index < 5; index += 1) {
    assert.equal((await login('admin', 'wrong-password', lockedClient)).statusCode, 401);
  }

  assert.equal((await login('admin', process.env.HELIX_ADMIN_PASSWORD, lockedClient)).statusCode, 429);
  assert.equal((await login('owner', process.env.HELIX_OWNER_PASSWORD, lockedClient)).statusCode, 200);
  assert.equal((await login('admin', process.env.HELIX_ADMIN_PASSWORD, otherClient)).statusCode, 200);
});

test('successful admin login clears failed attempts before lockout', async () => {
  const client = { ip: '203.0.113.47', userAgent: 'admin-login-reset-test' };

  for (let index = 0; index < 4; index += 1) {
    assert.equal((await login('admin', 'wrong-password', client)).statusCode, 401);
  }

  assert.equal((await login('admin', process.env.HELIX_ADMIN_PASSWORD, client)).statusCode, 200);
  assert.equal((await login('admin', 'wrong-password', client)).statusCode, 401);
});

function login(role, password, client) {
  return handleHelixApiRequest({
    method: 'POST',
    pathname: '/api/admin/login',
    url: '/api/admin/login',
    headers: {
      'user-agent': client.userAgent,
      'x-forwarded-for': client.ip,
    },
    bodyText: JSON.stringify({ role, password }),
  });
}
