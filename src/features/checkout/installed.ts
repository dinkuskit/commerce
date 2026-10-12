import { isRecord as isObject } from "../../shared/record.js";
import type { PluginContext, StorageCollection } from "emdash";
import type { CronEvent } from "emdash/plugin";
import { loadCheckoutContactRequirements } from "../store-settings/kernel/index.js";

import { GuestCheckoutError } from "./errors.js";
import {
  guestCheckoutFailure,
  prepareGuestCheckout,
  reconcileGuestPaymentWakes,
  startGuestCheckout,
  statusGuestCheckout,
} from "./guest.js";
import { admitGuestCheckoutWrite, headerValue } from "./origin-admission.js";
import { canonicalizeHttpOrigin, resolveTrustedSiteOrigin } from "./site-scope.js";
import {
  SANDBOX_GUEST_CHECKOUT_STORAGE,
  bindGuestCheckoutRuntime,
} from "./runtime.js";
import {
  CHECKOUT_READINESS_SCHEMA,
  type CheckoutReadinessResponse,
  type GuestCheckoutHostOptions,
  type GuestCheckoutResult,
} from "./types.js";
import type { CommercePaymentWakePort, WakeReconciliationResult } from "./wake.js";
import type { CheckoutCouponPort } from "../coupons/index.js";
import type { PaidOrderReceiver } from "../../handoffs/paid-order.js";
import { admitRegistryCheckoutConfig } from "./registry-provider-admission.js";
import { REGISTRY_CHECKOUT_SETTINGS_KEY, REGISTRY_STORE_KEY } from "./registry-services.js";

export const COMMERCE_CHECKOUT_WAKES_TASK = "commerce-checkout-wakes";
export const INSTALLED_COMMERCE_PLUGIN_ID = "dinkus-commerce";
/** EmDash 1.2.0 runtime ID for the manifest publisher DID and slug. */
export const COMMERCE_REGISTRY_RUNTIME_ID = "r_gshdrqaldna3r7sn";
export const CHECKOUT_READINESS_COLLECTION = "checkout_readiness";

const READINESS_RECORD_KEY = "readiness";

interface CachedReadinessState {
  version: 1;
  generation: string;
  status: "supported" | "unavailable";
  expiresAt: number;
  lastAttemptAt: number;
  attempts: number[];
}

function isReadinessState(value: unknown, now: number): value is CachedReadinessState {
  return isObject(value) && Object.keys(value).length === 6 && value.version === 1 &&
    typeof value.generation === "string" && value.generation.length > 0 && value.generation.length <= 1024 &&
    (value.status === "supported" || value.status === "unavailable") &&
    typeof value.lastAttemptAt === "number" && Number.isSafeInteger(value.lastAttemptAt) &&
    value.lastAttemptAt >= 0 && value.lastAttemptAt <= now &&
    value.expiresAt === value.lastAttemptAt + 900 &&
    Array.isArray(value.attempts) && value.attempts.length > 0 && value.attempts.length <= 100 &&
    value.attempts.includes(value.lastAttemptAt) &&
    value.attempts.every(t => Number.isSafeInteger(t) && t >= 0 && t <= (value.lastAttemptAt as number));
}

export interface InstalledGuestCheckoutRequest {
  input: unknown;
  request: { url: string; headers?: Headers | Record<string, string> };
}

type InstalledStorage = Record<string, unknown>;
type InstalledContext = Pick<PluginContext, "plugin" | "storage" | "site" | "settings">;

export interface InstalledCheckoutServices {
  host: GuestCheckoutHostOptions;
  wakes?: CommercePaymentWakePort;
  /** Bound by the entry's own resolver; the host options cannot carry it. */
  coupons?: CheckoutCouponPort;
}

export type InstalledCheckoutServiceResolver = (
  ctx: PluginContext,
) => InstalledCheckoutServices | Promise<InstalledCheckoutServices>;

export interface InstalledCheckoutHandlers {
  prepare(route: InstalledGuestCheckoutRequest, ctx: PluginContext): Promise<GuestCheckoutResult>;
  start(route: InstalledGuestCheckoutRequest, ctx: PluginContext): Promise<GuestCheckoutResult>;
  status(route: InstalledGuestCheckoutRequest, ctx: PluginContext): Promise<GuestCheckoutResult>;
  readiness(route: InstalledGuestCheckoutRequest, ctx: PluginContext): Promise<CheckoutReadinessResponse>;
  reconcileWakes(ctx: PluginContext): Promise<InstalledWakeResult>;
  cron(event: CronEvent, ctx: PluginContext): Promise<void>;
}

export type InstalledWakeResult =
  | { executed: false; reason: "not-configured" | "unavailable" }
  | { executed: true; results: WakeReconciliationResult[] };

/** Binds Orders' receiving side from the installation's own storage. */
export type InstalledPaidOrders = (ctx: PluginContext) => PaidOrderReceiver | undefined;

type CronHandler = (event: CronEvent, ctx: PluginContext) => Promise<void>;

const collectionMethods = {
  carts: ["getVersioned", "compareAndSet"],
  capabilities: ["compareAndSet", "get", "getVersioned"],
  catalogItems: ["get"],
  prices: ["get"],
  backorderPolicies: ["get"],
  manualAvailability: ["get"],
  configurations: ["query"],
  settings: ["get"],
  listing: ["get"],
  paymentAssociations: ["get", "compareAndSet"],
} as const;


function installedStorage(ctx: InstalledContext): InstalledStorage {
  if (!isObject(ctx.plugin) ||
      (ctx.plugin.id !== INSTALLED_COMMERCE_PLUGIN_ID &&
       ctx.plugin.id !== COMMERCE_REGISTRY_RUNTIME_ID) ||
      typeof ctx.plugin.version !== "string" || !ctx.plugin.version.trim() ||
      !isObject(ctx.storage) ||
      !isObject(ctx.site) ||
      typeof ctx.site.url !== "string") {
    throw new GuestCheckoutError("UNAVAILABLE");
  }

  const storage = ctx.storage as InstalledStorage;
  for (const [name, methods] of Object.entries(collectionMethods)) {
    const collection = storage[SANDBOX_GUEST_CHECKOUT_STORAGE[name as keyof typeof collectionMethods]];
    if (!isObject(collection) ||
        methods.some(method => typeof collection[method] !== "function")) {
      throw new GuestCheckoutError("UNAVAILABLE");
    }
  }
  return storage;
}

function siteOrigin(ctx: InstalledContext) {
  const resolved = resolveTrustedSiteOrigin({ runtimeSiteUrl: ctx.site.url });
  if (!resolved.ok) throw new GuestCheckoutError("UNAVAILABLE");
  return resolved.origin;
}

function runtimeFor(ctx: PluginContext, services: InstalledCheckoutServices, paidOrders?: InstalledPaidOrders) {
  const storage = installedStorage(ctx);
  const origin = siteOrigin(ctx);
  const host = Object.freeze({
    ...services.host,
    loadCheckoutContactRequirements: () =>
      loadCheckoutContactRequirements(ctx.settings),
  });
  const resolved = resolveTrustedSiteOrigin({
    constructorSiteUrl: host.siteUrl,
    runtimeSiteUrl: origin,
    topLevelSiteUrl: host.topLevelSiteUrl,
    checkoutSiteUrl: host.checkoutSiteUrl,
  });
  if (!resolved.ok || resolved.origin !== origin) throw new GuestCheckoutError("UNAVAILABLE");
  return bindGuestCheckoutRuntime(storage, SANDBOX_GUEST_CHECKOUT_STORAGE, {
    runtimeSiteUrl: origin,
    host,
    coupons: services.coupons,
    paidOrders: paidOrders?.(ctx),
  });
}

/**
 * Call only from runtime-owned plugin routes/hooks. These checks reject
 * obvious misbinding; they do not attest that a context is installed.
 */
export function createInstalledCheckoutHandlers(
  resolveServices: InstalledCheckoutServiceResolver = async () => ({ host: {} }),
  paidOrders?: InstalledPaidOrders,
): InstalledCheckoutHandlers {
  async function guest(
    route: InstalledGuestCheckoutRequest,
    ctx: PluginContext,
    action: (runtime: ReturnType<typeof runtimeFor>) => Promise<GuestCheckoutResult>,
  ): Promise<GuestCheckoutResult> {
    try {
      installedStorage(ctx);
      admitGuestCheckoutWrite({
        requestUrl: route.request.url,
        headers: route.request.headers,
        siteOrigin: siteOrigin(ctx),
      });
      // Resolve against the original owner context, separately from browser input.
      const services = await resolveServices(ctx);
      return await action(runtimeFor(ctx, services, paidOrders));
    } catch (error) {
      return guestCheckoutFailure(error instanceof GuestCheckoutError ? error.code : "UNAVAILABLE");
    }
  }

  async function readiness(
    route: InstalledGuestCheckoutRequest,
    ctx: PluginContext,
  ): Promise<CheckoutReadinessResponse> {
    const unavailable: CheckoutReadinessResponse = { schema: CHECKOUT_READINESS_SCHEMA, status: "unavailable" };
    const supported: CheckoutReadinessResponse = { schema: CHECKOUT_READINESS_SCHEMA, status: "supported", mode: "test" };
    try {
      installedStorage(ctx);
      const origin = siteOrigin(ctx), presented = headerValue(route.request.headers, "origin");
      if (ctx.plugin.id !== COMMERCE_REGISTRY_RUNTIME_ID || !ctx.settings || !ctx.http ||
          canonicalizeHttpOrigin(route.request.url) !== origin ||
          presented && canonicalizeHttpOrigin(presented) !== origin) return unavailable;
      const store = ctx.storage[CHECKOUT_READINESS_COLLECTION] as Pick<StorageCollection<CachedReadinessState>, "getVersioned" | "compareAndSet">;
      if (typeof store?.getVersioned !== "function" || typeof store.compareAndSet !== "function") return unavailable;
      const config = await ctx.settings.getVersioned(REGISTRY_CHECKOUT_SETTINGS_KEY);
      const key = await ctx.settings.getVersioned(REGISTRY_STORE_KEY);
      const admitted = admitRegistryCheckoutConfig(config?.value ?? null, origin);
      if (!admitted || (admitted.mode ?? "test") !== "test" ||
          typeof key?.value !== "string" || !key.value.trim() || key.value.trim().length > 512 ||
          !config?.revision || !key.revision) return unavailable;
      const generation = (c: { revision: string } | null, k: { revision: string } | null) =>
        JSON.stringify([origin, c?.revision, k?.revision]);
      const gen = generation(config, key);
      const snapshot = await store.getVersioned(READINESS_RECORD_KEY);
      const now = Math.floor(Date.now() / 1000);
      if (snapshot && !isReadinessState(snapshot.value, now)) return unavailable;
      const old = snapshot?.value;
      if (old?.generation === gen && now < old.expiresAt) return old.status === "supported" ? supported : unavailable;
      const attempts = old ? old.attempts.filter(t => t > now - 86400) : [];
      if (old && now - old.lastAttemptAt < 60 || attempts.length >= 100) return unavailable;
      // One durable claim, charged before upstream work. Its unavailable value also
      // supplies the failure/crash cooldown; a generation change never resets its budget.
      const claim: CachedReadinessState = { version: 1, generation: gen, status: "unavailable",
        expiresAt: now + 900, lastAttemptAt: now, attempts: [...attempts, now] };
      const acquired = await store.compareAndSet(READINESS_RECORD_KEY, snapshot?.revision ?? null, claim);
      if (!acquired.applied || Date.now() / 1000 >= now + 30) return unavailable;
      const services = await resolveServices(ctx);
      runtimeFor(ctx, services);
      const host = services.host;
      if ((host.paymentMode ?? "test") !== "test" || !host.paymentBindingRef) return unavailable;
      const binding = await (await host.resolvePayments?.(host.paymentBindingRef))?.verifyBinding?.();
      if (binding?.ready !== true || binding.mode !== "test") return unavailable;
      const current = generation(await ctx.settings.getVersioned(REGISTRY_CHECKOUT_SETTINGS_KEY),
        await ctx.settings.getVersioned(REGISTRY_STORE_KEY));
      // The claim's opaque CAS revision is the fence. Never re-read and adopt a
      // replacement writer's revision. A late result cannot publish after its lease.
      const finished = Date.now() / 1000;
      if (current !== gen || finished < now || finished >= now + 30) return unavailable;
      const published = await store.compareAndSet(READINESS_RECORD_KEY, acquired.revision, { ...claim, status: "supported" });
      return published.applied && Date.now() / 1000 < now + 30 ? supported : unavailable;
    } catch {
      return unavailable;
    }
  }

  async function reconcileWakes(ctx: PluginContext): Promise<InstalledWakeResult> {
    try {
      installedStorage(ctx);
      siteOrigin(ctx);
      const services = await resolveServices(ctx);
      if (!services.wakes) return { executed: false, reason: "not-configured" };
      const results = await reconcileGuestPaymentWakes(runtimeFor(ctx, services, paidOrders), services.wakes);
      return { executed: true, results };
    } catch {
      return { executed: false, reason: "unavailable" };
    }
  }

  return {
    prepare: (route, ctx) => guest(route, ctx, runtime => prepareGuestCheckout(runtime, route.input)),
    start: (route, ctx) => guest(route, ctx, runtime => startGuestCheckout(runtime, route.input, route.request.headers)),
    status: (route, ctx) => guest(route, ctx, runtime => statusGuestCheckout(runtime, route.input, route.request.headers)),
    readiness,
    reconcileWakes,
    cron: async (event, ctx) => {
      if (event.name === COMMERCE_CHECKOUT_WAKES_TASK) await reconcileWakes(ctx);
    },
  };
}

export function createInstalledCheckoutWakeHook(
  resolveServices?: InstalledCheckoutServiceResolver,
  paidOrders?: InstalledPaidOrders,
): CronHandler {
  return createInstalledCheckoutHandlers(resolveServices, paidOrders).cron;
}
