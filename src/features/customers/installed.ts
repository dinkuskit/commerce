import type { PluginContext } from "emdash";
import { isRecord } from "../../shared/record.js";
import { isCommerceInstallationId } from "../../shared/plugin-identity.js";
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
import { ShopperAccountError, shopperAccountFailure } from "./errors.js";
import {
  CUSTOMERS_COLLECTION,
  CUSTOMER_LOGIN_CODES_COLLECTION,
  CUSTOMER_SESSIONS_COLLECTION,
  NATIVE_CUSTOMERS_COLLECTION,
  NATIVE_CUSTOMER_LOGIN_CODES_COLLECTION,
  NATIVE_CUSTOMER_SESSIONS_COLLECTION,
  type CustomerLoginCodesStorage,
  type CustomerSessionsStorage,
  type CustomersStorage,
  type ShopperAccountHostOptions,
  type ShopperAccountOrdersResult,
  type ShopperAccountProfileResult,
  type ShopperAccountRuntime,
  type ShopperSignInStartResult,
  type ShopperSignInVerifyResult,
  type ShopperSignOutResult,
} from "./types.js";
import type { ShopperOrderSummary } from "../orders/index.js";

export interface ShopperAccountStorageNames {
  customers: string;
  loginCodes: string;
  sessions: string;
}

export const SANDBOX_SHOPPER_ACCOUNT_STORAGE: ShopperAccountStorageNames = {
  customers: CUSTOMERS_COLLECTION,
  loginCodes: CUSTOMER_LOGIN_CODES_COLLECTION,
  sessions: CUSTOMER_SESSIONS_COLLECTION,
};

export const NATIVE_SHOPPER_ACCOUNT_STORAGE: ShopperAccountStorageNames = {
  customers: NATIVE_CUSTOMERS_COLLECTION,
  loginCodes: NATIVE_CUSTOMER_LOGIN_CODES_COLLECTION,
  sessions: NATIVE_CUSTOMER_SESSIONS_COLLECTION,
};

export interface InstalledShopperAccountRequest {
  input?: unknown;
  request: { url: string; method?: string; headers?: Headers | Record<string, string> };
}

export type InstalledOrdersForEmailLoader = (
  ctx: PluginContext,
  emailKey: string,
) => Promise<ShopperOrderSummary[]>;

export interface InstalledShopperAccountHandlers {
  startSignIn(route: InstalledShopperAccountRequest, ctx: PluginContext): Promise<ShopperSignInStartResult>;
  verifySignIn(route: InstalledShopperAccountRequest, ctx: PluginContext): Promise<ShopperSignInVerifyResult>;
  signOut(route: InstalledShopperAccountRequest, ctx: PluginContext): Promise<ShopperSignOutResult>;
  orders(route: InstalledShopperAccountRequest, ctx: PluginContext): Promise<ShopperAccountOrdersResult>;
  profile(route: InstalledShopperAccountRequest, ctx: PluginContext): Promise<ShopperAccountProfileResult>;
}

const collectionMethods = {
  customers: ["get", "getVersioned", "compareAndSet"],
  loginCodes: ["get", "getVersioned", "compareAndSet", "delete"],
  sessions: ["get", "getVersioned", "compareAndSet", "delete"],
} as const;

export function bindShopperAccountRuntime(
  storage: Record<string, unknown>,
  names: ShopperAccountStorageNames,
  options: {
    runtimeSiteUrl?: string;
    constructorSiteUrl?: string;
    topLevelSiteUrl?: string;
    host?: ShopperAccountHostOptions;
  } = {},
): ShopperAccountRuntime {
  const resolveCol = (key: keyof ShopperAccountStorageNames) =>
    storage[names[key]] ?? storage[SANDBOX_SHOPPER_ACCOUNT_STORAGE[key]];
  for (const [name, methods] of Object.entries(collectionMethods)) {
    const collection = resolveCol(name as keyof ShopperAccountStorageNames);
    if (!isRecord(collection) || methods.some((method) => typeof collection[method] !== "function")) {
      throw new ShopperAccountError("UNAVAILABLE");
    }
  }
  return {
    customers: resolveCol("customers") as CustomersStorage,
    loginCodes: resolveCol("loginCodes") as CustomerLoginCodesStorage,
    sessions: resolveCol("sessions") as CustomerSessionsStorage,
    runtimeSiteUrl: options.runtimeSiteUrl,
    constructorSiteUrl: options.constructorSiteUrl ?? options.host?.siteUrl,
    topLevelSiteUrl: options.topLevelSiteUrl ?? options.host?.topLevelSiteUrl,
    host: options.host ?? {},
  };
}

function installedOrigin(ctx: Pick<PluginContext, "plugin" | "storage" | "site">): string {
  if (
    !isRecord(ctx.plugin) ||
    !isCommerceInstallationId(ctx.plugin.id) ||
    typeof ctx.plugin.version !== "string" ||
    !ctx.plugin.version.trim() ||
    !isRecord(ctx.storage) ||
    !isRecord(ctx.site) ||
    typeof ctx.site.url !== "string"
  ) {
    throw new ShopperAccountError("UNAVAILABLE");
  }
  const resolved = resolveTrustedSiteOrigin({ runtimeSiteUrl: ctx.site.url });
  if (!resolved.ok) throw new ShopperAccountError("UNAVAILABLE");
  return resolved.origin;
}

function installedRuntime(
  ctx: PluginContext,
  loadOrdersForEmail: InstalledOrdersForEmailLoader,
  hostOverrides?: ShopperAccountHostOptions,
): ShopperAccountRuntime {
  const origin = installedOrigin(ctx);
  const storeName = typeof ctx.site?.name === "string" && ctx.site.name.trim() ? ctx.site.name.trim() : undefined;
  return bindShopperAccountRuntime(ctx.storage as Record<string, unknown>, SANDBOX_SHOPPER_ACCOUNT_STORAGE, {
    runtimeSiteUrl: origin,
    host: {
      storeName,
      sendEmail: ctx.email?.send ? (msg) => ctx.email!.send(msg) : undefined,
      loadOrdersForEmail: (emailKey) => loadOrdersForEmail(ctx, emailKey),
      loadShippingCountries: async () => {
        const reqs = await loadCheckoutContactRequirements(ctx.settings);
        return { requirePhoneNumber: reqs.requirePhoneNumber, shippingCountries: reqs.shippingCountries };
      },
      ...hostOverrides,
    },
  });
}

function admitReadRequestUrl(requestUrl: string, siteOrigin: string): void {
  const requestOrigin = canonicalizeHttpOrigin(requestUrl);
  if (requestOrigin === null || requestOrigin !== siteOrigin) {
    throw new ShopperAccountError("ORIGIN_DENIED");
  }
}

export function createInstalledShopperAccountHandlers(
  loadOrdersForEmail: InstalledOrdersForEmailLoader,
  hostOverrides?: ShopperAccountHostOptions,
): InstalledShopperAccountHandlers {
  // Writes need a same-origin browser request; reads only a request URL on this site.
  const run = <T>(write: boolean | ((route: InstalledShopperAccountRequest) => boolean),
    action: (runtime: ShopperAccountRuntime, route: InstalledShopperAccountRequest) => Promise<T>) =>
    async (route: InstalledShopperAccountRequest, ctx: PluginContext): Promise<T> => {
      try {
        const runtime = installedRuntime(ctx, loadOrdersForEmail, hostOverrides);
        if (typeof write == "function" ? write(route) : write) {
          admitShopperAccountOrigin({
            requestUrl: route.request.url,
            headers: route.request.headers,
            siteOrigin: runtime.runtimeSiteUrl!,
          });
        } else admitReadRequestUrl(route.request.url, runtime.runtimeSiteUrl!);
        return await action(runtime, route);
      } catch (error) {
        return shopperAccountFailure(error instanceof ShopperAccountError ? error.code : "UNAVAILABLE") as T;
      }
    };
  const isPost = (route: InstalledShopperAccountRequest) =>
    (route.request.method ?? (route.input !== undefined ? "POST" : "GET")).toUpperCase() === "POST";
  return {
    startSignIn: run(true, (runtime, route) => startShopperSignIn(runtime, route.input)),
    verifySignIn: run(true, (runtime, route) => verifyShopperSignIn(runtime, route.input)),
    signOut: run(true, (runtime, route) => signOutShopperSession(runtime, route.input, route.request.headers)),
    orders: run(false, (runtime, route) => readShopperAccountOrders(runtime, route.request.headers)),
    profile: run(isPost, (runtime, route) => isPost(route)
      ? updateShopperAccountProfile(runtime, route.input, route.request.headers)
      : readShopperAccountProfile(runtime, route.request.headers)),
  };
}
