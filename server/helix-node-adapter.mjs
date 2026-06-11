import { handleHelixApiRequest, maxBodyBytes } from './helix-api.mjs';

export async function handleHelixApiNodeRequest(request, response, pathname) {
  const bodyText = await readRequestBody(request);
  const result = await handleHelixApiRequest({
    method: request.method ?? 'GET',
    pathname,
    url: request.url ?? pathname,
    headers: request.headers,
    bodyText,
  });

  writeNodeResponse(response, result);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bodyBytes = 0;

    request.on('data', (chunk) => {
      bodyBytes += chunk.byteLength;

      if (bodyBytes > maxBodyBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    request.on('error', reject);
  });
}

function writeNodeResponse(response, result) {
  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, value);
  }

  response.writeHead(result.statusCode);
  response.end(result.body);
}
