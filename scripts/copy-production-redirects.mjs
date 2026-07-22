import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('../netlify/production-redirects', import.meta.url);
const destinationUrl = new URL('../dist/_redirects', import.meta.url);

await mkdir(dirname(fileURLToPath(destinationUrl)), { recursive: true });
await copyFile(sourceUrl, destinationUrl);

console.log('Copied production redirects to dist/_redirects.');
