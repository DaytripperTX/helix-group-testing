import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const action = process.argv[2];
const dataDir = path.join(rootDir, 'dist', 'stored-data');
const backupDir = path.join(rootDir, 'node_modules', '.tmp', 'stored-data-backup');

if (action === 'backup') {
  await rm(backupDir, { force: true, recursive: true });

  if (existsSync(dataDir)) {
    await mkdir(path.dirname(backupDir), { recursive: true });
    await cp(dataDir, backupDir, { recursive: true });
  }
} else if (action === 'restore') {
  if (existsSync(backupDir)) {
    await mkdir(path.dirname(dataDir), { recursive: true });
    await cp(backupDir, dataDir, { recursive: true });
    await rm(backupDir, { force: true, recursive: true });
  }
} else {
  throw new Error('Expected "backup" or "restore".');
}
