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
  for (const [name, methods] of Object.entries(collectionMethods)) {
    const key = names[name as keyof ShopperAccountStorageNames];
    const collection = storage[key] ?? storage[SANDBOX_SHOPPER_ACCOUNT_STORAGE[name as keyof ShopperAccountStorageNames]];
    if (!isRecord(collection) || methods.some((method) => typeof collection[method] !== "function")) {
      throw new ShopperAccountError("UNAVAILABLE");
    }
  }
  const resolveCol = (key: keyof ShopperAccountStorageNames) =>
    storage[names[key]] ?? storage[SANDBOX_SHOPPER_ACCOUNT_STORAGE[key]];
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
  return {
    async startSignIn(route, ctx) {
      try {
        const runtime = installedRuntime(ctx, loadOrdersForEmail, hostOverrides);
        admitShopperAccountOrigin({
          requestUrl: route.request.url,
          headers: route.request.headers,
          siteOrigin: runtime.runtimeSiteUrl!,
        });
        return await startShopperSignIn(runtime, route.input);
      } catch (error) {
        return shopperAccountFailure(error instanceof ShopperAccountError ? error.code : "UNAVAILABLE");
      }
    },
    async verifySignIn(route, ctx) {
      try {
        const runtime = installedRuntime(ctx, loadOrdersForEmail, hostOverrides);
        admitShopperAccountOrigin({
          requestUrl: route.request.url,
          headers: route.request.headers,
          siteOrigin: runtime.runtimeSiteUrl!,
        });
        return await verifyShopperSignIn(runtime, route.input);
      } catch (error) {
        return shopperAccountFailure(error instanceof ShopperAccountError ? error.code : "UNAVAILABLE");
      }
    },
    async signOut(route, ctx) {
      try {
        const runtime = installedRuntime(ctx, loadOrdersForEmail, hostOverrides);
        admitShopperAccountOrigin({
          requestUrl: route.request.url,
          headers: route.request.headers,
          siteOrigin: runtime.runtimeSiteUrl!,
        });
        return await signOutShopperSession(runtime, route.input, route.request.headers);
      } catch (error) {
        return shopperAccountFailure(error instanceof ShopperAccountError ? error.code : "UNAVAILABLE");
      }
    },
    async orders(route, ctx) {
      try {
        const runtime = installedRuntime(ctx, loadOrdersForEmail, hostOverrides);
        admitReadRequestUrl(route.request.url, runtime.runtimeSiteUrl!);
        return await readShopperAccountOrders(runtime, route.request.headers);
      } catch (error) {
        return shopperAccountFailure(error instanceof ShopperAccountError ? error.code : "UNAVAILABLE");
      }
    },
    async profile(route, ctx) {
      try {
        const runtime = installedRuntime(ctx, loadOrdersForEmail, hostOverrides);
        const method = (route.request.method ?? (route.input !== undefined ? "POST" : "GET")).toUpperCase();
        if (method === "POST") {
          admitShopperAccountOrigin({
            requestUrl: route.request.url,
            headers: route.request.headers,
            siteOrigin: runtime.runtimeSiteUrl!,
          });
          return await updateShopperAccountProfile(runtime, route.input, route.request.headers);
        }
        admitReadRequestUrl(route.request.url, runtime.runtimeSiteUrl!);
        return await readShopperAccountProfile(runtime, route.request.headers);
      } catch (error) {
        return shopperAccountFailure(error instanceof ShopperAccountError ? error.code : "UNAVAILABLE");
      }
    },
  };
}
