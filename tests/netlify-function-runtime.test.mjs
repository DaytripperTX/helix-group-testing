import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Netlify admin function uses the modern Request/Response runtime', async () => {
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
    const { default: handler } = await import(`../netlify/functions/admin.mjs?runtime=${Date.now()}`);
    const sessionResponse = await handler(new Request('https://example.netlify.app/api/admin/session'));

    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), { isAuthenticated: false });

    const loginResponse = await handler(new Request('https://example.netlify.app/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'node-test',
      },
      body: JSON.stringify({ role: 'admin', password: 'admin-test-password' }),
    }));

    assert.equal(loginResponse.status, 200);
    assert.match(loginResponse.headers.get('set-cookie'), /^helix_admin_session=/);
    assert.deepEqual(await loginResponse.json(), {
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
