import { PluginRouteError, type PluginRoute } from "emdash";
import { canonicalizeHttpOrigin, resolveTrustedSiteOrigin } from "../checkout/kernel/index.js";
import { loadCheckoutContactRequirements } from "../store-settings/kernel/index.js";
import {
  admitShopperAccountOrigin,
  readShopperAccountOrders,
  readShopperAccountProfile,
  signOutShopperSession,
  startShopperSignIn,
  updateShopperAccountProfile,
  verifyShopperSignIn,
} from "./account.js";
import { ShopperAccountError } from "./errors.js";
import { NATIVE_SHOPPER_ACCOUNT_STORAGE, bindShopperAccountRuntime } from "./installed.js";
import {
  SHOPPER_ACCOUNT_ORDERS_ROUTE,
  SHOPPER_ACCOUNT_PROFILE_ROUTE,
  SHOPPER_ACCOUNT_SESSION_HEADERS,
  SHOPPER_ACCOUNT_WRITE_HEADERS,
  SHOPPER_SIGN_IN_START_ROUTE,
  SHOPPER_SIGN_IN_VERIFY_ROUTE,
  SHOPPER_SIGN_OUT_ROUTE,
  type ShopperAccountHostOptions,
} from "./types.js";
import type { ShopperOrderSummary } from "../orders/index.js";

export type NativeOrdersForEmailLoader = (
  storage: Record<string, unknown>,
  emailKey: string,
) => Promise<ShopperOrderSummary[]>;

function routeFail(code: string, message: string, status: number): never {
  throw new PluginRouteError(code, message, status);
}

function throwIfDenied<T extends { ok: boolean; error?: { code: ShopperAccountError["code"]; message: string } }>(
  result: T,
): T {
  if (result.ok) return result;
  const { code, message } = result.error!;
  throw new PluginRouteError(code, message, new ShopperAccountError(code).status);
}

function nativeRuntime(
  ctx: Parameters<PluginRoute["handler"]>[0],
  options: ShopperAccountHostOptions,
  loadOrders?: NativeOrdersForEmailLoader,
) {
  const storage = ctx.storage as Record<string, unknown>;
  const resolved = resolveTrustedSiteOrigin({
    constructorSiteUrl: options.siteUrl,
    topLevelSiteUrl: options.topLevelSiteUrl,
    runtimeSiteUrl: ctx.site?.url,
  });
  if (!resolved.ok) throw new ShopperAccountError("UNAVAILABLE");
  const storeName = options.storeName ?? (typeof ctx.site?.name === "string" && ctx.site.name.trim() ? ctx.site.name.trim() : undefined);
  return bindShopperAccountRuntime(storage, NATIVE_SHOPPER_ACCOUNT_STORAGE, {
    runtimeSiteUrl: resolved.origin,
    constructorSiteUrl: options.siteUrl,
    topLevelSiteUrl: options.topLevelSiteUrl,
    host: {
      ...options,
      storeName,
      sendEmail: options.sendEmail ?? (ctx.email?.send ? (msg) => ctx.email!.send(msg) : undefined),
      loadOrdersForEmail: options.loadOrdersForEmail ?? (loadOrders ? (emailKey) => loadOrders(storage, emailKey) : undefined),
      loadShippingCountries:
        options.loadShippingCountries ??
        (async () => {
          const reqs = await loadCheckoutContactRequirements(ctx.settings);
          return { requirePhoneNumber: reqs.requirePhoneNumber, shippingCountries: reqs.shippingCountries };
        }),
    },
  });
}

async function runNative<T extends { ok: boolean; error?: { code: ShopperAccountError["code"]; message: string } }>(
  ctx: Parameters<PluginRoute["handler"]>[0],
  options: ShopperAccountHostOptions,
  loadOrders: NativeOrdersForEmailLoader | undefined,
  requireWriteOrigin: boolean,
  action: (runtime: ReturnType<typeof nativeRuntime>) => Promise<T>,
): Promise<T> {
  try {
    const runtime = nativeRuntime(ctx, options, loadOrders);
    if (requireWriteOrigin) {
      admitShopperAccountOrigin({
        requestUrl: ctx.request.url,
        headers: ctx.request.headers,
        siteOrigin: runtime.runtimeSiteUrl!,
      });
    } else {
      const requestOrigin = canonicalizeHttpOrigin(ctx.request.url);
      if (requestOrigin === null || requestOrigin !== runtime.runtimeSiteUrl) {
        throw new ShopperAccountError("ORIGIN_DENIED");
      }
    }
    return throwIfDenied(await action(runtime));
  } catch (error) {
    if (error instanceof PluginRouteError) throw error;
    if (error instanceof ShopperAccountError) {
      throw new PluginRouteError(error.code, error.message, error.status);
    }
    const fallback = new ShopperAccountError("UNAVAILABLE");
    throw new PluginRouteError(fallback.code, fallback.message, fallback.status);
  }
}

export function createShopperSignInStartRoute(
  options: ShopperAccountHostOptions = {},
): PluginRoute {
  return {
    public: true,
    methods: ["POST"],
    request: { body: "json", headers: [...SHOPPER_ACCOUNT_WRITE_HEADERS] },
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        routeFail("METHOD_NOT_ALLOWED", "account sign-in start requires POST", 405);
      }
      return runNative(ctx, options, undefined, true, (runtime) => startShopperSignIn(runtime, ctx.input));
    },
  };
}

export function createShopperSignInVerifyRoute(
  options: ShopperAccountHostOptions = {},
  loadOrders?: NativeOrdersForEmailLoader,
): PluginRoute {
  return {
    public: true,
    methods: ["POST"],
    request: { body: "json", headers: [...SHOPPER_ACCOUNT_WRITE_HEADERS] },
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        routeFail("METHOD_NOT_ALLOWED", "account sign-in verify requires POST", 405);
      }
      return runNative(ctx, options, loadOrders, true, (runtime) => verifyShopperSignIn(runtime, ctx.input));
    },
  };
}

export function createShopperSignOutRoute(
  options: ShopperAccountHostOptions = {},
): PluginRoute {
  return {
    public: true,
    methods: ["POST"],
    request: { body: "json", headers: [...SHOPPER_ACCOUNT_SESSION_HEADERS] },
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        routeFail("METHOD_NOT_ALLOWED", "account sign-out requires POST", 405);
      }
      return runNative(ctx, options, undefined, true, (runtime) =>
        signOutShopperSession(runtime, ctx.input, ctx.request.headers),
      );
    },
  };
}

export function createShopperAccountOrdersRoute(
  options: ShopperAccountHostOptions = {},
  loadOrders?: NativeOrdersForEmailLoader,
): PluginRoute {
  return {
    public: true,
    methods: ["GET"],
    request: { body: "none", headers: [...SHOPPER_ACCOUNT_SESSION_HEADERS] },
    cacheControl: "no-store",
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "GET") {
        routeFail("METHOD_NOT_ALLOWED", "account orders requires GET", 405);
      }
      return runNative(ctx, options, loadOrders, false, (runtime) =>
        readShopperAccountOrders(runtime, ctx.request.headers),
      );
    },
  };
}

export function createShopperAccountProfileRoute(
  options: ShopperAccountHostOptions = {},
  loadOrders?: NativeOrdersForEmailLoader,
): PluginRoute {
  return {
    public: true,
    methods: ["GET", "POST"],
    request: { body: "json", headers: [...SHOPPER_ACCOUNT_SESSION_HEADERS] },
    cacheControl: "no-store",
    handler: async (ctx) => {
      const method = ctx.request.method.toUpperCase();
      if (method === "GET") {
        return runNative(ctx, options, loadOrders, false, (runtime) =>
          readShopperAccountProfile(runtime, ctx.request.headers),
        );
      }
      if (method === "POST") {
        return runNative(ctx, options, loadOrders, true, (runtime) =>
          updateShopperAccountProfile(runtime, ctx.input, ctx.request.headers),
        );
      }
      routeFail("METHOD_NOT_ALLOWED", "account profile requires GET or POST", 405);
    },
  };
}

export {
  SHOPPER_ACCOUNT_ORDERS_ROUTE,
  SHOPPER_ACCOUNT_PROFILE_ROUTE,
  SHOPPER_SIGN_IN_START_ROUTE,
  SHOPPER_SIGN_IN_VERIFY_ROUTE,
  SHOPPER_SIGN_OUT_ROUTE,
};
