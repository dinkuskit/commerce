import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import couponPlugin from "./coupon-plugin.mjs";

const siteUrl = process.env.EMDASH_SITE_URL;
const database = process.env.COMMERCE_COUPON_BROWSER_DB ?? "file:./.artifacts/coupons.db";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: database }),
      storage: local({ directory: ".artifacts/uploads", baseUrl: "/_emdash/api/media/file" }),
      ...(siteUrl ? { siteUrl } : {}),
      plugins: [couponPlugin],
    }),
  ],
  devToolbar: { enabled: false },
});
