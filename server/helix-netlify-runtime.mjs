import { connectLambda, setEnvironmentContext } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { handleHelixApiRequest } from './helix-api.mjs';
import { verifyHelixRequestOrigin } from './helix-request-origin.mjs';

const defaultIdentityServices = {
  getUser,
  verifyRequestOrigin,
};

export async function handleHelixNetlifyRequest(request) {
  return handleHelixNetlifyRequestWithIdentity(request, defaultIdentityServices);
}

export async function handleHelixNetlifyRequestWithIdentity(request, identity) {
  const identityUser = await getOptionalIdentityUser(identity);
  let identityOriginVerified = false;

  if (identityUser && !isSafeHttpMethod(request.method)) {
    try {
      verifyHelixRequestOrigin(request, identity.verifyRequestOrigin);
      identityOriginVerified = true;
    } catch {
      return Response.json({ error: 'Origin not allowed.' }, {
        status: 403,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
  }

  const result = await handleHelixApiRequest({
    method: request.method ?? 'GET',
    pathname: new URL(request.url).pathname,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    bodyText: await request.text(),
    identityUser,
    identityOriginVerified,
  });

  return createWebResponse(result);
}

function isSafeHttpMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method ?? 'GET').toUpperCase());
}

async function getOptionalIdentityUser(identity) {
  try {
    return await identity.getUser();
  } catch {
    // Identity may be disabled or unavailable. Public APIs remain public and
    // protected APIs fail closed through their normal unauthenticated path.
    return null;
  }
}

export async function handleHelixLambdaEvent(event) {
  connectHelixNetlifyRuntime(event);

  return handleHelixApiRequest({
    method: event.httpMethod ?? 'GET',
    pathname: event.path ?? '/api/data',
    url: event.rawUrl ?? event.path ?? '/api/data',
    headers: event.headers ?? {},
    bodyText: event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : event.body ?? '',
  });
}

export function connectHelixNetlifyRuntime(event) {
  if (event?.blobs) {
    connectLambda(event);
    preserveUncachedBlobContext(event);
  }
}

function preserveUncachedBlobContext(event) {
  try {
    const data = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
    const uncachedEdgeURL = data.uncachedURL ?? data.uncachedUrl ?? data.uncached_url;

    if (!uncachedEdgeURL) {
      return;
    }

    setEnvironmentContext({
      edgeURL: data.url,
      siteID: event.headers?.['x-nf-site-id'],
      token: data.token,
      uncachedEdgeURL,
    });
  } catch {
    // connectLambda already populated the standard context; strong consistency just remains unavailable.
  }
}

function createWebResponse(result) {
  const body = result.isBase64Encoded
    ? Buffer.from(result.body ?? '', 'base64')
    : result.body ?? '';

  return new Response(body, {
    status: result.statusCode ?? 200,
    headers: result.headers ?? {},
  });
}
