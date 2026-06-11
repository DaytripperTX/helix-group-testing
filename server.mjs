import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleHelixApiNodeRequest } from './server/helix-node-adapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT ?? 4173);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleHelixApiNodeRequest(request, response, url.pathname);
      return;
    }

    await serveStaticFile(url.pathname, response);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Server error' }));
  }
});

server.listen(port, () => {
  console.log(`Helix Group Testing server running at http://127.0.0.1:${port}`);
});

async function serveStaticFile(pathname, response) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const resolvedPath = path.resolve(distDir, `.${decodeURIComponent(requestedPath)}`);

  if (!resolvedPath.startsWith(distDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  const filePath = (await isFile(resolvedPath)) ? resolvedPath : path.join(distDir, 'index.html');
  const file = await readFile(filePath);
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';

  response.writeHead(200, { 'Content-Type': contentType });
  response.end(file);
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
