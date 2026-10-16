import { fileURLToPath } from 'node:url';
import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import emdash, { local } from 'emdash/astro';
import { sqlite } from 'emdash/db';
import commerce from '../../../dist/sandbox/index.mjs';
const { default: payments } = await import(process.env.LOCAL_PAYMENTS_DESCRIPTOR);
export default defineConfig({
  output: 'server', adapter: node({ mode: 'standalone' }),
  vite: { server: { strictPort: true } },
  integrations: [react(), emdash({
    database: sqlite({ url: process.env.LOCAL_MERCHANT_DB }),
    storage: local({ directory: process.env.LOCAL_MERCHANT_STORAGE, baseUrl: '/_emdash/api/media/file' }),
    siteUrl: process.env.EMDASH_SITE_URL, fonts: false,
    sandboxRunner: fileURLToPath(new URL('../runner.mjs', import.meta.url)),
    sandboxed: [
      { ...commerce, entrypoint: fileURLToPath(new URL('../../../dist/sandbox/plugin.mjs', import.meta.url)) },
      { ...payments, id: 'r_3brsc2on3bu673rn', entrypoint: process.env.LOCAL_PAYMENTS_BACKEND },
    ],
  })], devToolbar: { enabled: false },
});
