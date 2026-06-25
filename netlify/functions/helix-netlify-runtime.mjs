import { connectLambda, setEnvironmentContext } from '@netlify/blobs';

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
