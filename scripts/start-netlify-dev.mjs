import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const netlifyCliPath = fileURLToPath(new URL('../node_modules/netlify-cli/bin/run.js', import.meta.url));
const viteCliPath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const childEnvironment = {
  ...process.env,
  PGUSER: process.env.PGUSER || 'netlify',
};

let activeChild;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => activeChild?.kill(signal));
}

const migrationExitCode = await runNode(netlifyCliPath, ['database', 'migrations', 'apply']);

if (migrationExitCode !== 0) {
  process.exitCode = migrationExitCode;
} else {
  process.exitCode = await runNode(viteCliPath, ['--host', '0.0.0.0']);
}

function runNode(entryPath, args) {
  return new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, [entryPath, ...args], {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: 'inherit',
    });
    activeChild.once('error', reject);
    activeChild.once('exit', (code, signal) => {
      activeChild = undefined;
      resolve(code ?? (signal ? 0 : 1));
    });
  });
}
