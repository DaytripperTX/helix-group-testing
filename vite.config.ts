import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleHelixApiNodeRequest } from './server/helix-node-adapter.mjs';
import { parseDisabledPages } from './src/page-disables';

const defaultNetlifySiteName = 'helix-group-testing';

export default defineConfig(({ mode }) => {
  const cwd = process.cwd();
  const env = loadEnv(mode, cwd, '');
  const disabledPagesValue = getDisabledPagesValue(mode, cwd, env.DISABLED_PAGES);
  const disabledPages = parseDisabledPages(disabledPagesValue);
  const previewServerAllowedHosts = getPreviewServerAllowedHosts(env);

  return {
    define: {
      __HELIX_DISABLED_PAGES__: JSON.stringify(disabledPages),
    },
    plugins: [react(), helixApiPlugin()],
    server: {
      allowedHosts: previewServerAllowedHosts,
    },
    preview: {
      allowedHosts: previewServerAllowedHosts,
    },
  };
});

function getPreviewServerAllowedHosts(environment: Record<string, string>) {
  const siteName = normalizeDnsLabel(environment.SITE_NAME) || defaultNetlifySiteName;
  const branchSlug = normalizeNetlifyBranchSlug(environment.BRANCH);

  if (!branchSlug) {
    return [];
  }

  return [`devserver-${branchSlug}--${siteName}.netlify.app`];
}

function normalizeNetlifyBranchSlug(value: string | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeDnsLabel(value: string | undefined) {
  const label = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? label : '';
}

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
