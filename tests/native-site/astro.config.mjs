import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { dinkusCommerce } from "../../dist/index.js";

const enableLocalStockManagement = process.env.COMMERCE_ENABLE_LOCAL_STOCK === "true";
const siteUrl = process.env.EMDASH_SITE_URL || process.env.COMMERCE_SITE_URL;

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: process.env.COMMERCE_PROOF_DB ?? "file:./.artifacts/content.db" }),
      storage: local({ directory: ".artifacts/uploads", baseUrl: "/_emdash/api/media/file" }),
      ...(siteUrl ? { siteUrl } : {}),
      plugins: [dinkusCommerce({
        enableLocalStockManagement,
        ...(siteUrl ? { siteUrl } : {}),
      })],
    }),
  ],
  devToolbar: { enabled: false },
});
