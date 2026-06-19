import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { handleHelixApiNodeRequest } from './server/helix-node-adapter.mjs';
import { parseDisabledPages } from './src/page-disables';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const disabledPages = parseDisabledPages(env.DISABLED_PAGES);

  return {
    define: {
      __HELIX_DISABLED_PAGES__: JSON.stringify(disabledPages),
    },
    plugins: [react(), helixApiPlugin()],
  };
});

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
