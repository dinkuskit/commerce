import { isRecord as object } from "../../shared/record.js";
import type { PluginContext } from "emdash";
import { createTrustedTestPaymentsCheckoutHost, readBoundedPaymentsJson } from "./test-payments.js";
import type { CommercePaymentWake, CommercePaymentWakePort } from "./wake.js";
import { CHECKOUT_PRICING_SCHEMA } from "./types.js";
import { registryUnavailable as unavailable, registryText as text, exactKeys as keys } from "./registry-guards.js";
import { resolveTrustedSiteOrigin } from "./site-scope.js";
import { isCommerceInstallationId } from "../../shared/plugin-identity.js";
import type { InstalledCheckoutServices } from "./installed.js";
import {
  REGISTRY_CHECKOUT_CONFIG_SCHEMA,
  admitRegistryCheckoutConfig,
  trustedPaymentsHostConfig,
  type RegistryCheckoutConfig,
} from "./registry-provider-admission.js";
import { admitCredential, tradeStoreKey } from "./registry-credential.js";
import { CHECKOUT_SETTING, storeKey } from "./registry-connect.js";
import type { ShipConnection } from "../orders/index.js";

export { REGISTRY_CHECKOUT_CONFIG_SCHEMA };
export type { RegistryCheckoutConfig };
export const REGISTRY_CHECKOUT_SETTINGS_KEY = CHECKOUT_SETTING;



function isWake(value: unknown, bindingRef: string): value is CommercePaymentWake {
  return object(value) && keys(value, "attemptId,bindingRef,deliveryGeneration,eventId,wokeAt") &&
    text(value.eventId) && /^evt_[A-Za-z0-9]+$/.test(value.eventId) && text(value.attemptId) &&
    value.bindingRef === bindingRef && Number.isSafeInteger(value.deliveryGeneration) &&
    (value.deliveryGeneration as number) > 0 && typeof value.wokeAt === "number" &&
    Number.isFinite(value.wokeAt) && value.wokeAt >= 0;
}

function wakePort(
  config: RegistryCheckoutConfig,
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  credential: () => Promise<string>,
): CommercePaymentWakePort {
  async function call(path: string, body?: CommercePaymentWake): Promise<unknown> {
    const token = await credential();
    const response = await fetch(`${new URL(config.paymentsOrigin).origin}${path}`, {
      method: body ? "POST" : "GET", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", authorization: `Bearer ${token}`,
        "x-dinkus-site": config.siteId, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("Payments wake transport unavailable");
    return readBoundedPaymentsJson(response);
  }
  return {
    async list() {
      const values = await call(`/v1/checkout/wakes?bindingRef=${encodeURIComponent(config.bindingRef)}&limit=100`);
      if (!Array.isArray(values) || values.length > 100 || !values.every(value => isWake(value, config.bindingRef))) unavailable();
      return values;
    },
    async acknowledge(event) {
      if (!isWake(event, config.bindingRef)) unavailable();
      const result = await call("/v1/checkout/wakes/ack", structuredClone(event));
      if (!object(result) || !keys(result, "acknowledged") || typeof result.acknowledged !== "boolean") unavailable();
      return result.acknowledged;
    },
  };
}

/** The store's admitted checkout configuration and origin, or null while checkout is unconfigured. */
async function registryConfig(ctx: PluginContext) {
  if (!object(ctx.plugin) ||
      !isCommerceInstallationId(ctx.plugin.id)) unavailable();
  const site = resolveTrustedSiteOrigin({ runtimeSiteUrl: ctx.site?.url });
  if (!site.ok) unavailable();
  // Keep the existing unconfigured prepare/capability behavior; start still has no Payments port.
  if (!ctx.settings) return null;
  const snapshot = await ctx.settings.getVersioned(REGISTRY_CHECKOUT_SETTINGS_KEY);
  const config = admitRegistryCheckoutConfig(snapshot?.value ?? null, site.origin);
  if (!config || !ctx.http) return null;
  if (!snapshot || !text(snapshot.revision)) unavailable();
  return { config, origin: site.origin };
}

/**
 * Passes for one invocation. Until Connect has given Commerce its store key nothing is configured; then
 * each service's pass is traded the first time a call needs it, then rechecked, expiry included, before every call.
 */
async function storePasses(ctx: PluginContext, config: RegistryCheckoutConfig) {
  const found = await storeKey(ctx), fetch = ctx.http!.fetch.bind(ctx.http), traded: Record<string, Promise<string>> = {};
  if (found?.siteId !== config.siteId) unavailable();
  const key = found!.key;
  return (scope = "payments:checkout", audience = config.audience) => async () => admitCredential(
    await (traded[scope] ??= tradeStoreKey(key, config, fetch, scope, audience)), config, scope, audience);
}

export async function resolveRegistryCheckoutServices(ctx: PluginContext): Promise<InstalledCheckoutServices> {
  const found = await registryConfig(ctx);
  if (!found) return { host: {} };
  const { config, origin } = found;
  const pass = await storePasses(ctx, config), credential = pass();
  const fetch = ctx.http!.fetch.bind(ctx.http);
  const host = createTrustedTestPaymentsCheckoutHost({
    ...trustedPaymentsHostConfig(config, origin),
    credentialResolver: credential, fetch,
  });
  // Coupons are unhooked from the Registry build for v1 to save room (GrillTrack
  // registry-coupons-unhooked-v1): settings may still name the coupon service,
  // but a coupon code is refused before any call. REGISTRY_BUILD gates in
  // checkout (pricing, orchestrate, project, test-payments) keep the coupon
  // paths out of the bundle; lift them when the port is wired again.
  return {
    host: { ...host, pricing: { paymentPricingSchema: CHECKOUT_PRICING_SCHEMA,
      resolveShippingConfiguration: async () => structuredClone(config.shipping) } },
    wakes: wakePort(config, fetch, credential),
  };
}

/**
 * Ship's hosted service for Orders when the store's configuration names one. Its ship:orders
 * pass is traded once per sync, only when Orders talks to Ship; no Payments pass is needed.
 */
export async function resolveRegistryShip(ctx: PluginContext): Promise<ShipConnection | undefined> {
  const config = (await registryConfig(ctx))?.config, ship = config?.ship;
  return ship && { origin: ship.origin, site: config!.siteId, name: ctx.site?.name, fetch: ctx.http!.fetch.bind(ctx.http), read: readBoundedPaymentsJson,
    current: async () => {
        const latest = (await registryConfig(ctx))?.config;
        return latest?.siteId === config!.siteId && latest.issuer === config!.issuer && latest.ship?.origin === ship.origin && latest.ship?.audience === ship.audience;
      },
    credential: (await storePasses(ctx, config!))("ship:orders", ship.audience) };
}
