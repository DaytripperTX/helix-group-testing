import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Netlify admin function loads and handles session/login requests', async () => {
  const previousEnv = {
    NETLIFY: process.env.NETLIFY,
    HELIX_ADMIN_PASSWORD: process.env.HELIX_ADMIN_PASSWORD,
    HELIX_OWNER_PASSWORD: process.env.HELIX_OWNER_PASSWORD,
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
  };

  process.env.NETLIFY = 'true';
  process.env.HELIX_ADMIN_PASSWORD = 'admin-test-password';
  process.env.HELIX_OWNER_PASSWORD = 'owner-test-password';
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-session-secret-for-netlify-function';

  try {
    const { handler } = await import(`../netlify/functions/admin.mjs?runtime=${Date.now()}`);
    const sessionResponse = await handler({
      httpMethod: 'GET',
      path: '/api/admin/session',
      rawUrl: 'https://example.netlify.app/api/admin/session',
      headers: {},
      body: null,
      isBase64Encoded: false,
    });

    assert.equal(sessionResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(sessionResponse.body), { isAuthenticated: false });

    const loginResponse = await handler({
      httpMethod: 'POST',
      path: '/api/admin/login',
      rawUrl: 'https://example.netlify.app/api/admin/login',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'node-test',
      },
      body: JSON.stringify({ role: 'admin', password: 'admin-test-password' }),
      isBase64Encoded: false,
    });

    assert.equal(loginResponse.statusCode, 200);
    assert.match(loginResponse.headers['Set-Cookie'], /^helix_admin_session=/);
    assert.deepEqual(JSON.parse(loginResponse.body), {
      isAuthenticated: true,
      role: 'admin',
    });
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
