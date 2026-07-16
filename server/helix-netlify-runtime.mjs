import { connectLambda, setEnvironmentContext } from '@netlify/blobs';
import { handleHelixApiRequest } from './helix-api.mjs';

export async function handleHelixNetlifyRequest(request) {
  const result = await handleHelixApiRequest({
    method: request.method ?? 'GET',
    pathname: new URL(request.url).pathname,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    bodyText: await request.text(),
  });

  return createWebResponse(result);
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
