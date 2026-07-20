import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleHelixNetlifyRequestWithIdentity } from '../server/helix-netlify-runtime.mjs';

process.env.HELIX_LEGACY_ADMIN_AUTH = 'true';

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

test('Netlify Identity admin writes accept the current Helix Preview Server origin', async () => {
  const previousEnv = {
    NETLIFY_PREVIEW_SERVER: process.env.NETLIFY_PREVIEW_SERVER,
    SITE_NAME: process.env.SITE_NAME,
    URL: process.env.URL,
    HELIX_ADMIN_SESSION_SECRET: process.env.HELIX_ADMIN_SESSION_SECRET,
  };
  const previewOrigin = 'https://devserver-feat-user-accounts--helix-group-testing.netlify.app';
  const identity = {
    async getUser() {
      return { id: 'preview-identity-user' };
    },
    verifyRequestOrigin(request, options) {
      const origin = request.headers.get('origin');

      if (!(options?.allowedOrigins ?? []).includes(origin)) {
        const error = new Error('Origin not allowed.');
        error.status = 403;
        throw error;
      }
    },
  };

  process.env.NETLIFY_PREVIEW_SERVER = 'true';
  process.env.SITE_NAME = 'helix-group-testing';
  process.env.URL = 'https://helix-group-testing.netlify.app';
  process.env.HELIX_ADMIN_SESSION_SECRET = 'test-preview-origin-session-secret';

  try {
    const accepted = await handleHelixNetlifyRequestWithIdentity(new Request(
      'http://localhost:8888/api/admin/logout',
      { method: 'POST', headers: { origin: previewOrigin } },
    ), identity);
    assert.equal(accepted.status, 200);

    const rejected = await handleHelixNetlifyRequestWithIdentity(new Request(
      'http://localhost:8888/api/admin/logout',
      { method: 'POST', headers: { origin: 'https://attacker.example' } },
    ), identity);
    assert.equal(rejected.status, 403);
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
