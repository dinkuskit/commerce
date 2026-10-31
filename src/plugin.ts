import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";
import { CATALOG_API_ROUTE, catalogApi, commerceAdmin, productMediaPanel, productPanel, syncOrdersWithShip } from "./admin/index.js";
import { PRODUCT_PAGE_ON_SALE_ROUTE, PRODUCT_PAGES_COLLECTION, setProductPageOnSale, type ProductPages } from "./features/catalog/kernel/index.js";
import {
  PUBLIC_CATALOG_ROUTE,
  PUBLIC_CATALOG_ITEM_ROUTE,
  readPublicCatalog,
  readPublicCatalogItem,
} from "./features/catalog/storefront/index.js";
import {
  COMMERCE_CHECKOUT_WAKES_TASK,
  createInstalledCheckoutHandlers,
  ensureBackgroundCheck,
  GUEST_CHECKOUT_DECLARED_HEADERS,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_READINESS_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  refreshCheckoutSettings,
  resolveRegistryCheckoutServices,
  storeProof,
  withBackgroundCheck,
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
function shopperRoute<T>(methods: ("GET" | "POST")[], request: { body: "json" | "none"; headers: string[] },
  handler: (route: Parameters<typeof installedShopperAccounts.orders>[0], ctx: Parameters<typeof installedShopperAccounts.orders>[1]) => Promise<T>) {
  return pluginRoute({ public: true, methods, request, cacheControl: "no-store", handler });
}
function guestRoute(handler: typeof installedCheckout.prepare) {
  return pluginRoute({ public: true, methods: ["POST"], request: guestRequest, handler });
}
type PublicReadHandler = Parameters<typeof pluginRoute>[0]["handler"];
/** A public, uncached GET with no body, as every storefront read is. */
const publicRead = (handler: PublicReadHandler, headers?: ["origin"]) => pluginRoute({ public: true, methods: ["GET"], request: { body: "none", ...(headers ? { headers } : {}) }, cacheControl: "no-store", handler });
/** The one query key a storefront read takes: at most once, or exactly once when required; anything else is refused. */
function queryValue(url: string, key: string, refusal: string, required = false): string | undefined {
  const query = new URL(url).searchParams, values = query.getAll(key);
  if ([...query.keys()].some(name => name !== key) || values.length > 1 || (required && !values.length)) throw new Error(refusal);
  return values[0];
}

type PrivateRoute = Extract<NonNullable<SandboxedPlugin["routes"]>[string], { handler: unknown }>;
/** A private POST route for signed-in users holding the permission. */
const privatePost = (permission: PrivateRoute["permission"], handler: PrivateRoute["handler"]): PrivateRoute => ({ public: false, permission, methods: ["POST"], handler });

const plugin: SandboxedPlugin = {
  hooks: {
    // Switched on: the site's EmDash scheduler runs the background check every 5 minutes. If the
    // scheduler fails or stalls here, the next request registers it instead (see routes below).
    "plugin:activate": async (_event, ctx) => {
      await ensureBackgroundCheck(ctx, true);
    },
    // The background check settles payments, then brings Orders and Ship up to date. Its passes from
    // DinkusKit.com and calls to Payments and Ship outlast EmDash's default 5-second hook limit, which
    // stopped it before Ship, so it gets 25 seconds (inside the sandbox's 30-second wall-time limit).
    cron: {
      timeout: 25_000,
      handler: async (event, ctx) => {
        // A change made at DinkusKit.com reaches checkout within one run (store-connect-checkout-settings-083).
        if (event.name === COMMERCE_CHECKOUT_WAKES_TASK) await refreshCheckoutSettings(ctx);
        await installedCheckout.cron(event, ctx);
        if (event.name === COMMERCE_CHECKOUT_WAKES_TASK) await syncOrdersWithShip(ctx).catch(() => {});
      },
    },
  },
  routes: {
    [PUBLIC_CATALOG_ROUTE]: publicRead(async (route, ctx) => readPublicCatalog(ctx, queryValue(route.request.url, "cursor", "Invalid catalog query"))),
    // Exactly one itemId, or exactly one pageId for the product a published page sells.
    [PUBLIC_CATALOG_ITEM_ROUTE]: publicRead(async (route, ctx) => {
      const page = new URL(route.request.url).searchParams.has("pageId");
      return readPublicCatalogItem(ctx, queryValue(route.request.url, page ? "pageId" : "itemId", "Invalid catalog item query", true)!, page);
    }),
    [PUBLIC_STORE_POLICIES_ROUTE]: publicRead(async (_route, ctx) => readSandboxPublicStorePolicies(ctx)),
    // DinkusKit.com reads a waiting Connect's receipt here, on the store's own web address.
    "store-proof": { public: true, methods: ["GET"], response: "raw", request: { body: "none" }, handler: (route, ctx) => storeProof(route.input, ctx) },
    admin: privatePost("content:edit_any", commerceAdmin),
    // The Dinkus Commerce panel on each Content > Products page.
    "product-panel": privatePost("content:edit_any", productPanel),
    "product-media-panel": privatePost("content:edit_any", productMediaPanel),
    // The store's publish check: a published product page puts its product on sale (catalog-product-states-20261023).
    [PRODUCT_PAGE_ON_SALE_ROUTE]: privatePost("content:publish_any", (route, ctx) => setProductPageOnSale({ catalog: ctx.storage["catalog_items"] as never,
      pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages }, route.input)),
    // Agents and the CLI manage products here with an EmDash API token (catalog-api-20261027).
    [CATALOG_API_ROUTE]: privatePost("content:edit_any", catalogApi),
    // Agents and the CLI work orders here with an EmDash API token of an Editor or Administrator.
    [ORDERS_API_ROUTE]: privatePost("content:edit_any", async (route, ctx) => {
      const answer = await ordersApi(route, ctx);
      // Ship hears about a saved change right away, as it does from the Orders page.
      if ((answer as { result?: string }).result === "saved") await syncOrdersWithShip(ctx).catch(() => {});
      return answer;
    }),
    [GUEST_CHECKOUT_PREPARE_ROUTE]: guestRoute(installedCheckout.prepare),
    [GUEST_CHECKOUT_START_ROUTE]: guestRoute(installedCheckout.start),
    [GUEST_CHECKOUT_STATUS_ROUTE]: guestRoute(installedCheckout.status),
    [GUEST_CHECKOUT_READINESS_ROUTE]: publicRead((route, ctx) => installedCheckout.readiness(route, ctx), ["origin"]),
    [SHOPPER_SIGN_IN_START_ROUTE]: shopperRoute(["POST"], shopperWriteRequest, installedShopperAccounts.startSignIn),
    [SHOPPER_SIGN_IN_VERIFY_ROUTE]: shopperRoute(["POST"], shopperWriteRequest, installedShopperAccounts.verifySignIn),
    [SHOPPER_SIGN_OUT_ROUTE]: shopperRoute(["POST"], shopperSessionBodyRequest, installedShopperAccounts.signOut),
    [SHOPPER_ACCOUNT_ORDERS_ROUTE]: shopperRoute(["GET"], { body: "none", headers: [...SHOPPER_ACCOUNT_SESSION_HEADERS] }, installedShopperAccounts.orders),
    [SHOPPER_ACCOUNT_PROFILE_ROUTE]: shopperRoute(["GET", "POST"], shopperSessionBodyRequest, installedShopperAccounts.profile),
  },
};
// Every route also registers the background check if switching on could not; after that it costs nothing.
for (const [name, route] of Object.entries(plugin.routes!)) {
  plugin.routes![name] = typeof route === "function" ? withBackgroundCheck(route) : { ...route, handler: withBackgroundCheck(route.handler) };
}
export default plugin;
