import { handleHelixApiRequest } from '../../server/helix-api.mjs';

export async function handler(event) {
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
