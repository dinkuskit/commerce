// Draws Commerce settings as the built plugin answers a page load, with EmDash's own BlockRenderer
// and the admin stylesheet. DinkusKit.com is a stand-in that answers the store:connection read.
//   npm run build && node proof/connected-to-20261122/render.mjs
import { readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockRenderer } from "@emdash-cms/blocks";
import { chromium } from "playwright";
import { settingsAdmin } from "../../dist/admin/settings.js";

const dir = new URL(".", import.meta.url), KEY = "dk_store_" + "c".repeat(43);
const css = await readFile(new URL("../../node_modules/@emdash-cms/admin/dist/styles.css", import.meta.url), "utf8");
async function answer(connection) {
  const stored = new Map([["connection", { value: JSON.stringify({ siteId: "8b2f0c1e-acme", storeKey: KEY }), revision: "1" }]]);
  const ctx = {
    plugin: { id: "r_gshdrqaldna3r7sn" }, site: { url: "https://acme-goods.example" },
    settings: { get: async n => stored.get(n)?.value ?? null, getVersioned: async n => stored.get(n) ?? null, compareAndSet: async () => ({ applied: true }) },
    kv: { get: async () => null, set: async () => {}, delete: async () => {} },
    storage: new Proxy({}, { get: () => new Proxy({}, { get: (_, op) => async () => op === "query" ? { items: [] } : null }) }),
    http: { fetch: async url => url.endsWith("/api/store-passes") ? Response.json({ access_token: "pass" })
      : connection ? Response.json(connection) : Response.json({ error: "unavailable" }, { status: 503 }) },
  };
  return settingsAdmin({ ui: { surface: "admin-page" }, user: { id: "admin", role: 50 }, input: { type: "page_load", page: "/settings" } }, ctx);
}
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const [name, connection] of [
  ["settings-connected-to", { business: "Acme Goods", site_origin: "https://acme-goods.example", plugins: ["commerce", "payments", "ship"] }],
  ["settings-read-failed", null],
]) {
  const { blocks } = await answer(connection);
  await writeFile(new URL(`${name}.blocks.json`, dir), JSON.stringify(blocks, null, 2) + "\n");
  const body = renderToStaticMarkup(createElement(BlockRenderer, { blocks, onAction: () => {} }));
  const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="background:#fff"><main style="max-width:780px;padding:32px">${body}</main></body></html>`);
  await page.screenshot({ path: new URL(`${name}.png`, dir).pathname, fullPage: true });
  await page.close();
}
await browser.close();
