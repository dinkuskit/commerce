import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { dinkusCommerce } from "../../dist/index.js";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: process.env.COMMERCE_PROOF_DB ?? "file:./.artifacts/content.db" }),
      storage: local({ directory: ".artifacts/uploads", baseUrl: "/_emdash/api/media/file" }),
      plugins: [dinkusCommerce()],
    }),
  ],
  devToolbar: { enabled: false },
});
