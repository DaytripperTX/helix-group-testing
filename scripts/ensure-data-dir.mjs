import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const labelDataDir = path.join(rootDir, 'dist', 'stored-data', 'labels');
const labelsJsonPath = path.join(labelDataDir, 'templates.json');

await mkdir(labelDataDir, { recursive: true });

if (!existsSync(labelsJsonPath)) {
  await writeFile(labelsJsonPath, '[]\n', 'utf8');
}
