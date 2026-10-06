import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import emdash, { local } from 'emdash/astro';
import { sqlite } from 'emdash/db';

// No configured Commerce descriptor. The test seeds an unsigned local
// installed profile, then exercises EmDash's registry state/storage loader.
export default defineConfig({
  output: 'server', adapter: node({ mode: 'standalone' }),
  integrations: [react(), emdash({
    database: sqlite({ url: process.env.COMMERCE_PROOF_DB }),
    storage: local({ directory: process.env.COMMERCE_PROOF_STORAGE, baseUrl: '/_emdash/api/media/file' }),
    sandboxRunner: '@emdash-cms/sandbox-workerd/sandbox',
    registry: 'https://registry.emdashcms.com',
    siteUrl: process.env.EMDASH_SITE_URL,
  })],
  devToolbar: { enabled: false },
});
