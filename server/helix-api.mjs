import {
  deleteCollectionItem,
  getCollectionNames,
  publicUpsertLabelTemplate,
  readCollection,
  upsertCollectionItem,
} from './helix-data.mjs';
import {
  createAdminSessionCookie,
  createLogoutCookie,
  getAdminSession,
  getPublicSession,
  validateAdminPassword,
} from './helix-auth.mjs';

const maxBodyBytes = 24 * 1024 * 1024;

export { maxBodyBytes };

export async function handleHelixApiRequest(request) {
  const method = request.method.toUpperCase();
  const pathname = normalizeApiPath(request.pathname);

  try {
    if (method === 'GET' && pathname.startsWith('/api/data/')) {
      return jsonResponse(200, await readCollection(getPathPart(pathname, 3)));
    }

    if (pathname === '/api/labels') {
      if (method === 'GET') {
        return jsonResponse(200, await readCollection('label-templates'));
      }

      if (method === 'POST') {
        return jsonResponse(200, await publicUpsertLabelTemplate(parseJsonBody(request.bodyText)));
      }
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
      const body = parseJsonBody(request.bodyText);

      if (!validateAdminPassword(body?.password)) {
        return jsonResponse(401, { error: 'Invalid password' });
      }

      return jsonResponse(200, getPublicSession({ role: 'owner' }), {
        'Set-Cookie': createAdminSessionCookie(),
      });
    }

    if (pathname === '/api/admin/session' && method === 'GET') {
      return jsonResponse(200, getPublicSession(getAdminSession(request.headers)));
    }

    if (pathname === '/api/admin/logout' && method === 'POST') {
      return jsonResponse(200, { ok: true }, { 'Set-Cookie': createLogoutCookie() });
    }

    if (pathname.startsWith('/api/admin/data/')) {
      const session = getAdminSession(request.headers);

      if (!session) {
        return jsonResponse(401, { error: 'Admin login required' });
      }

      const collectionName = getPathPart(pathname, 4);
      const itemId = decodeURIComponent(getPathPart(pathname, 5));

      if (!collectionName || !itemId) {
        return jsonResponse(404, { error: 'Unknown admin endpoint' });
      }

      if (method === 'PUT') {
        return jsonResponse(
          200,
          await upsertCollectionItem(collectionName, itemId, parseJsonBody(request.bodyText)),
        );
      }

      if (method === 'DELETE') {
        return jsonResponse(200, await deleteCollectionItem(collectionName, itemId));
      }
    }

    if (method === 'GET' && pathname === '/api/data') {
      return jsonResponse(200, { collections: getCollectionNames() });
    }

    return jsonResponse(404, { error: 'Unknown endpoint' });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    const message = statusCode === 500 ? 'Server error' : error.message;

    if (statusCode === 500) {
      console.error(error);
    }

    return jsonResponse(statusCode, { error: message });
  }
}

export function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(bodyText) {
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function normalizeApiPath(pathname) {
  if (pathname.startsWith('/.netlify/functions/data')) {
    const nextPathname = pathname.replace('/.netlify/functions/data', '/api/data');
    return nextPathname === '/api/data/labels' ? '/api/labels' : nextPathname;
  }

  if (pathname.startsWith('/.netlify/functions/admin')) {
    return pathname.replace('/.netlify/functions/admin', '/api/admin');
  }

  return pathname;
}

function getPathPart(pathname, index) {
  return pathname.split('/')[index] ?? '';
}
