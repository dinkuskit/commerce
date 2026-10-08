import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { createPlugin as createNativePlugin, dinkusCommerce } from "../../dist/index.js";
import { fileURLToPath } from "node:url";

const enableLocalStockManagement = process.env.COMMERCE_ENABLE_LOCAL_STOCK === "true";
const siteUrl = process.env.EMDASH_SITE_URL || process.env.COMMERCE_SITE_URL;
const synthetic = process.env.COMMERCE_NATIVE_SYNTHETIC === "1";
const syntheticBinding = "synthetic:variant-proof:v1";
const syntheticSessions = new Map();

function syntheticPayments() {
  const paymentSession = (request) => {
    if (!request || typeof request !== "object" || Array.isArray(request) ||
        request.bindingRef !== syntheticBinding ||
        request.paymentMethods?.length !== 1 || request.paymentMethods[0] !== "card" ||
        !Array.isArray(request.lines) || !request.lines.length ||
        !request.total || request.total.currency !== "USD" ||
        typeof request.total.minor !== "string") {
      throw new Error("synthetic payment request rejected");
    }
    const frozen = structuredClone(request);
    const existing = syntheticSessions.get(request.attemptId);
    if (existing && JSON.stringify(existing.request) !== JSON.stringify(frozen)) {
      throw new Error("synthetic payment request changed");
    }
    const now = Math.floor(Date.now() / 1000);
    const session = existing?.session ?? {
      sessionId: "synthetic-session:" + request.attemptId,
      redirectUrl: "https://synthetic.invalid/checkout/" + encodeURIComponent(request.attemptId),
      createdAt: now,
      expiresAt: now + 1800,
    };
    syntheticSessions.set(request.attemptId, { request: frozen, session });
    return { request: frozen, session: structuredClone(session) };
  };
  return {
    pricingSchema: "dinkuskit.commerce.checkout-pricing/v1",
    ensureSession: async (request) => {
      const { session } = paymentSession(request);
      return { outcome: "open", attemptId: request.attemptId, total: structuredClone(request.total), session };
    },
    lookup: async (request) => {
      const existing = syntheticSessions.get(request.attemptId);
      if (!existing) return { outcome: "not-created", attemptId: request.attemptId };
      const { session } = paymentSession(request);
      return {
        outcome: "paid",
        attemptId: request.attemptId,
        total: structuredClone(existing.request.total),
        session,
        paymentId: "synthetic-payment:" + request.attemptId,
      };
    },
  };
}

export function createPlugin(options = {}) {
  const { synthetic: requestedSynthetic, ...pluginOptions } = options;
  return createNativePlugin({
    ...pluginOptions,
    ...(requestedSynthetic ? {
      checkout: {
        siteUrl: pluginOptions.siteUrl,
        paymentBindingRef: syntheticBinding,
        resolvePayments: async (bindingRef) =>
          bindingRef === syntheticBinding ? syntheticPayments() : null,
      },
    } : {}),
  });
}

const commerce = synthetic
  ? {
      ...dinkusCommerce({ ...(siteUrl ? { siteUrl } : {}) }),
      entrypoint: fileURLToPath(new URL("./astro.config.mjs", import.meta.url)),
      options: { ...(siteUrl ? { siteUrl } : {}), synthetic: true },
    }
  : dinkusCommerce({
      enableLocalStockManagement,
      ...(siteUrl ? { siteUrl } : {}),
    });

export default defineConfig({
  srcDir: fileURLToPath(new URL("../sandbox-site/src", import.meta.url)),
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: process.env.COMMERCE_PROOF_DB ?? "file:./.artifacts/content.db" }),
      storage: local({ directory: ".artifacts/uploads", baseUrl: "/_emdash/api/media/file" }),
      ...(siteUrl ? { siteUrl } : {}),
      plugins: [commerce],
    }),
  ],
  devToolbar: { enabled: false },
});
