import { normalizeMoney } from "../catalog/kernel/index.js";
import { isRecord as obj } from "../../shared/record.js";
import { registryUnavailable as fail, registryText as text, exactKeys as keys } from "./registry-guards.js";
import { CHECKOUT_PRICING_SCHEMA, type TrustedShippingConfiguration } from "./types.js";

export const REGISTRY_CHECKOUT_CONFIG_SCHEMA = "dinkuskit.commerce.registry-checkout/v1" as const;
export type RegistryCheckoutProviderId = "stripe" | "authorize_net";

export interface RegistryCheckoutConfig {
  schema: typeof REGISTRY_CHECKOUT_CONFIG_SCHEMA;
  enabled: true;
  commerceOrigin: string;
  siteId: string;
  paymentsOrigin: string;
  bindingRef: string;
  providerId: RegistryCheckoutProviderId;
  stripeAccountId?: string;
  authorizeNetMerchantId?: string;
  mode?: "test";
  pricingSchema: typeof CHECKOUT_PRICING_SCHEMA;
  issuer: string;
  audience: string;
  shipping: TrustedShippingConfiguration;
  /** The hosted coupon service. Without it, coupon codes are unavailable. */
  coupons?: { origin: string; audience: string };
}

const BASE =
  "audience,bindingRef,commerceOrigin,enabled,issuer,paymentsOrigin,pricingSchema,providerId,schema,shipping,siteId";

function https(v: unknown, bare = true): v is string {
  if (!text(v, 2048)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash &&
      (!bare || u.pathname === "/");
  } catch { return false; }
}

function admitShipping(shipping: Record<string, unknown>): void {
  const hasAmount = shipping.amount !== undefined;
  if (!keys(shipping, hasAmount ? "amount,configurationId,mode,revision" : "configurationId,mode,revision") ||
      !text(shipping.configurationId) || !Number.isSafeInteger(shipping.revision) ||
      (shipping.revision as number) < 1 || (shipping.mode !== "free" && shipping.mode !== "flat") ||
      (shipping.mode === "flat" && !hasAmount)) fail();
  if (hasAmount) {
    let amount;
    try { amount = normalizeMoney(shipping.amount); } catch { fail(); }
    if (amount.currency !== "USD" || (shipping.mode === "free" && amount.minor !== "0")) fail();
  }
}

function keySet(providerId: RegistryCheckoutProviderId, mode: boolean, merchant: boolean, coupons: boolean): string {
  const parts = BASE.split(",");
  if (mode) parts.push("mode");
  if (coupons) parts.push("coupons");
  if (providerId === "stripe") parts.push("stripeAccountId");
  if (providerId === "authorize_net" && merchant) parts.push("authorizeNetMerchantId");
  return parts.sort().join(",");
}

export function admitRegistryCheckoutConfig(value: unknown, site: string): RegistryCheckoutConfig | null {
  if (value === null) return null;
  if (typeof value === "string") {
    if (value.length > 16384) fail();
    try { value = JSON.parse(value); } catch { fail(); }
  }
  if (!obj(value)) fail();
  if (keys(value, "enabled,schema") && value.schema === REGISTRY_CHECKOUT_CONFIG_SCHEMA && value.enabled === false) {
    return null;
  }
  const hasMode = value.mode !== undefined;
  const hasMerchant = value.authorizeNetMerchantId !== undefined;
  const coupons = value.coupons;
  const providerId = value.providerId;
  if (providerId !== "stripe" && providerId !== "authorize_net") fail();
  if (!keys(value, keySet(providerId, hasMode, hasMerchant, coupons !== undefined)) ||
      value.schema !== REGISTRY_CHECKOUT_CONFIG_SCHEMA || value.enabled !== true ||
      value.commerceOrigin !== site || !text(value.siteId) || !https(value.paymentsOrigin) ||
      !text(value.bindingRef) || value.pricingSchema !== CHECKOUT_PRICING_SCHEMA ||
      !https(value.issuer, false) || !text(value.audience) || !obj(value.shipping)) fail();
  if (hasMode && value.mode !== "test") fail();
  if (coupons !== undefined &&
      (!obj(coupons) || !keys(coupons, "audience,origin") || !https(coupons.origin) || !text(coupons.audience))) fail();
  if (providerId === "stripe") {
    if (!text(value.stripeAccountId) || hasMerchant) fail();
  } else if (value.stripeAccountId !== undefined || hasMerchant && !text(value.authorizeNetMerchantId)) {
    fail();
  }
  admitShipping(value.shipping);
  return structuredClone(value) as unknown as RegistryCheckoutConfig;
}

export function trustedPaymentsHostConfig(config: RegistryCheckoutConfig, commerceOrigin: string) {
  return {
    paymentsOrigin: config.paymentsOrigin, siteId: config.siteId, commerceOrigin,
    bindingRef: config.bindingRef, providerId: config.providerId,
    ...(config.providerId === "stripe"
      ? { stripeAccountId: config.stripeAccountId as string }
      : { authorizeNetMerchantId: config.authorizeNetMerchantId }),
    pricingSchema: CHECKOUT_PRICING_SCHEMA,
  };
}
