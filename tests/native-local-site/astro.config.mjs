import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { dinkusCommerce } from "../../dist/index.js";

const siteUrl = process.env.EMDASH_SITE_URL || process.env.COMMERCE_SITE_URL;
if (!siteUrl) {
  throw new Error(
    "native-local-site requires EMDASH_SITE_URL or COMMERCE_SITE_URL from the test host",
  );
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: process.env.COMMERCE_PROOF_DB ?? "file:./.artifacts/content.db" }),
      storage: local({ directory: ".artifacts/uploads", baseUrl: "/_emdash/api/media/file" }),
      siteUrl,
      plugins: [dinkusCommerce({ enableLocalStockManagement: true, siteUrl })],
    }),
  ],
  devToolbar: { enabled: false },
});
