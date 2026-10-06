import { fileURLToPath } from "node:url";
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import descriptor from "../../dist/sandbox/index.mjs";

const siteUrl = process.env.EMDASH_SITE_URL || process.env.COMMERCE_SITE_URL;

export default defineConfig({
  output: "server", adapter: node({ mode: "standalone" }),
  integrations: [react(), emdash({
    database: sqlite({ url: process.env.COMMERCE_PROOF_DB ?? "file:./.artifacts/content.db" }),
    storage: local({ directory: ".artifacts/uploads", baseUrl: "/_emdash/api/media/file" }),
    sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
    ...(siteUrl ? { siteUrl } : {}),
    sandboxed: [{ ...descriptor, entrypoint: process.env.COMMERCE_SANDBOX_ARTIFACT ?? fileURLToPath(new URL("../../dist/sandbox/plugin.mjs", import.meta.url)) }],
  })],
  devToolbar: { enabled: false },
});
