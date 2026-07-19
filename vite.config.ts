import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleHelixApiNodeRequest } from './server/helix-node-adapter.mjs';
import { parseDisabledPages } from './src/page-disables';

const previewServerAllowedHosts = [
  'devserver-feat-user-accounts--helix-group-testing.netlify.app',
];

export default defineConfig(({ mode }) => {
  const cwd = process.cwd();
  const env = loadEnv(mode, cwd, '');
  const disabledPagesValue = getDisabledPagesValue(mode, cwd, env.DISABLED_PAGES);
  const disabledPages = parseDisabledPages(disabledPagesValue);

  return {
    define: {
      __HELIX_DISABLED_PAGES__: JSON.stringify(disabledPages),
    },
    plugins: [react(), helixApiPlugin()],
    server: {
      allowedHosts: previewServerAllowedHosts,
    },
  };
});

function getDisabledPagesValue(mode: string, cwd: string, fallbackValue: string | undefined) {
  if (mode !== 'development') {
    return fallbackValue;
  }

  const localValue = readEnvLocalValue(cwd, 'DISABLED_PAGES');
  return localValue ?? fallbackValue;
}

function readEnvLocalValue(cwd: string, key: string) {
  const envLocalPath = resolve(cwd, '.env.local');

  if (!existsSync(envLocalPath)) {
    return undefined;
  }

  const lines = readFileSync(envLocalPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);

    if (!match || match[1] !== key) {
      continue;
    }

    return unwrapEnvValue(match[2]);
  }

  return undefined;
}

function unwrapEnvValue(value: string) {
  const trimmedValue = value.trim();
  const quote = trimmedValue[0];

  if (
    (quote === '"' || quote === "'") &&
    trimmedValue.endsWith(quote)
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function helixApiPlugin(): Plugin {
  return {
    name: 'helix-api',
    configureServer(server) {
      server.middlewares.use('/api', async (request, response, next) => {
        try {
          const url = new URL(request.url ?? '/', 'http://localhost');
          await handleHelixApiNodeRequest(request, response, `/api${url.pathname}`);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
