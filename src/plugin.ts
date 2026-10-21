import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";
import { commerceAdmin, syncOrdersWithShip } from "./admin/index.js";
import {
  PUBLIC_CATALOG_ROUTE,
  PUBLIC_CATALOG_ITEM_ROUTE,
  readPublicCatalog,
  readPublicCatalogItem,
} from "./features/catalog/storefront/index.js";
import {
  COMMERCE_CHECKOUT_WAKES_TASK,
  createInstalledCheckoutHandlers,
  GUEST_CHECKOUT_DECLARED_HEADERS,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_READINESS_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  resolveRegistryCheckoutServices,
} from "./features/checkout/kernel/index.js";
import { ORDER_NUMBERS_COLLECTION, ORDERS_API_ROUTE, ORDERS_COLLECTION, createPaidOrderReceiver, listOrdersForEmail, ordersApi, type OrderNumbers, type OrdersCollection } from "./features/orders/index.js";
import {
  createInstalledShopperAccountHandlers,
  SHOPPER_ACCOUNT_ORDERS_ROUTE,
  SHOPPER_ACCOUNT_PROFILE_ROUTE,
  SHOPPER_ACCOUNT_SESSION_HEADERS,
  SHOPPER_ACCOUNT_WRITE_HEADERS,
  SHOPPER_SIGN_IN_START_ROUTE,
  SHOPPER_SIGN_IN_VERIFY_ROUTE,
  SHOPPER_SIGN_OUT_ROUTE,
} from "./features/customers/kernel/index.js";
import {
  PUBLIC_STORE_POLICIES_ROUTE,
  readSandboxPublicStorePolicies,
} from "./features/store-policies/kernel/index.js";

const guestRequest = {
  body: "json" as const,
  headers: [...GUEST_CHECKOUT_DECLARED_HEADERS],
};
const shopperWriteRequest = {
  body: "json" as const,
  headers: [...SHOPPER_ACCOUNT_WRITE_HEADERS],
};
const shopperSessionBodyRequest = {
  body: "json" as const,
  headers: [...SHOPPER_ACCOUNT_SESSION_HEADERS],
};
// Checkout hands each paid order to Orders, which keeps its own copy.
const installedCheckout = createInstalledCheckoutHandlers(resolveRegistryCheckoutServices,
  ctx => createPaidOrderReceiver(ctx.storage[ORDERS_COLLECTION] as OrdersCollection, ctx.storage[ORDER_NUMBERS_COLLECTION] as OrderNumbers));
const installedShopperAccounts = createInstalledShopperAccountHandlers(
  (ctx, emailKey) => listOrdersForEmail(ctx.storage[ORDERS_COLLECTION] as OrdersCollection, emailKey),
);
function guestRoute(handler: typeof installedCheckout.prepare) {
  return pluginRoute({ public: true, methods: ["POST"], request: guestRequest, handler });
}
const plugin: SandboxedPlugin = {
  hooks: {
    // Switched on: the site's EmDash scheduler runs the background check every 5 minutes.
    "plugin:activate": async (_event, ctx) => {
      await ctx.cron?.schedule(COMMERCE_CHECKOUT_WAKES_TASK, { schedule: "*/5 * * * *" });
    },
    // The background check settles payments, then brings Orders and Ship up to date. Its passes from
    // DinkusKit.com and calls to Payments and Ship outlast EmDash's default 5-second hook limit, which
    // stopped it before Ship, so it gets 25 seconds (inside the sandbox's 30-second wall-time limit).
    cron: {
      timeout: 25_000,
      handler: async (event, ctx) => {
        await installedCheckout.cron(event, ctx);
        if (event.name === COMMERCE_CHECKOUT_WAKES_TASK) await syncOrdersWithShip(ctx).catch(() => {});
      },
    },
  },
  routes: {
    [PUBLIC_CATALOG_ROUTE]: pluginRoute({
      public: true,
      methods: ["GET"],
      request: { body: "none" },
      cacheControl: "no-store",
      handler: async (route, ctx) => {
        const query = new URL(route.request.url).searchParams;
        if ([...query.keys()].some(key => key !== "cursor") || query.getAll("cursor").length > 1) throw new Error("Invalid catalog query");
        return readPublicCatalog(ctx, query.get("cursor") ?? undefined);
      },
    }),
    [PUBLIC_CATALOG_ITEM_ROUTE]: pluginRoute({
      public: true,
      methods: ["GET"],
      request: { body: "none" },
      cacheControl: "no-store",
      handler: async (route, ctx) => {
        const query = new URL(route.request.url).searchParams;
        if ([...query.keys()].some((key) => key !== "itemId") || query.getAll("itemId").length !== 1) {
          throw new Error("Invalid catalog item query");
        }
        return readPublicCatalogItem(ctx, query.get("itemId")!);
      },
    }),
    [PUBLIC_STORE_POLICIES_ROUTE]: pluginRoute({
      public: true,
      methods: ["GET"],
      request: { body: "none" },
      cacheControl: "no-store",
      handler: async (_route, ctx) => readSandboxPublicStorePolicies(ctx),
    }),
    admin: {
      public: false,
      permission: "content:edit_any",
      methods: ["POST"],
      handler: commerceAdmin,
    },
    // Agents and the CLI read and complete orders here with an EmDash API token.
    [ORDERS_API_ROUTE]: {
      public: false,
      permission: "plugins:manage",
      methods: ["POST"],
      handler: async (route, ctx) => {
        const answer = await ordersApi(route, ctx);
        // Ship hears about a saved change right away, as it does from the Orders page.
        if ((answer as { result?: string }).result === "saved") await syncOrdersWithShip(ctx).catch(() => {});
        return answer;
      },
    },
    [GUEST_CHECKOUT_PREPARE_ROUTE]: guestRoute(installedCheckout.prepare),
    [GUEST_CHECKOUT_START_ROUTE]: guestRoute(installedCheckout.start),
    [GUEST_CHECKOUT_STATUS_ROUTE]: guestRoute(installedCheckout.status),
    [GUEST_CHECKOUT_READINESS_ROUTE]: pluginRoute({
      public: true,
      methods: ["GET"],
      request: { body: "none", headers: ["origin"] },
      cacheControl: "no-store",
      handler: (route, ctx) => installedCheckout.readiness(route, ctx),
    }),
    [SHOPPER_SIGN_IN_START_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: shopperWriteRequest,
      cacheControl: "no-store",
      handler: (route, ctx) => installedShopperAccounts.startSignIn(route, ctx),
    }),
    [SHOPPER_SIGN_IN_VERIFY_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: shopperWriteRequest,
      cacheControl: "no-store",
      handler: (route, ctx) => installedShopperAccounts.verifySignIn(route, ctx),
    }),
    [SHOPPER_SIGN_OUT_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: shopperSessionBodyRequest,
      cacheControl: "no-store",
      handler: (route, ctx) => installedShopperAccounts.signOut(route, ctx),
    }),
    [SHOPPER_ACCOUNT_ORDERS_ROUTE]: pluginRoute({
      public: true,
      methods: ["GET"],
      request: { body: "none", headers: [...SHOPPER_ACCOUNT_SESSION_HEADERS] },
      cacheControl: "no-store",
      handler: (route, ctx) => installedShopperAccounts.orders(route, ctx),
    }),
    [SHOPPER_ACCOUNT_PROFILE_ROUTE]: pluginRoute({
      public: true,
      methods: ["GET", "POST"],
      request: shopperSessionBodyRequest,
      cacheControl: "no-store",
      handler: (route, ctx) => installedShopperAccounts.profile(route, ctx),
    }),
  },
};
export default plugin;
