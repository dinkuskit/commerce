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
  GUEST_CHECKOUT_CART_ROUTE,
  refreshCheckoutSettings,
  resolveRegistryCheckoutServices,
  storeProof,
  withBackgroundCheck,
} from "./features/checkout/kernel/index.js";
import { ORDER_LOOKUP_ROUTE, ORDER_NUMBERS_COLLECTION, ORDERS_API_ROUTE, ORDERS_COLLECTION, clearOldLookupGuesses, createPaidOrderReceiver, lookUpOrder, ordersApi, type OrderNumbers, type OrdersCollection } from "./features/orders/index.js";

const guestRequest = {
  body: "json" as const,
  headers: [...GUEST_CHECKOUT_DECLARED_HEADERS],
};
// Checkout hands each paid order to Orders, which keeps its own copy.
const installedCheckout = createInstalledCheckoutHandlers(resolveRegistryCheckoutServices,
  ctx => createPaidOrderReceiver(ctx.storage[ORDERS_COLLECTION] as OrdersCollection, ctx.storage[ORDER_NUMBERS_COLLECTION] as OrderNumbers));
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

/**
 * A Products page's pending schedule: when, and, once EmDash's timer publishes it, the title to sell under. Each kind of
 * person writes only its own record (`<page>:e` an Editor or Admin, `<page>:a` anyone else), so no two requests race on one.
 */
type ScheduledSale = { at: unknown; go?: boolean; name?: unknown };
type SaleContext = { storage: Record<string, unknown>; log: { warn(message: string, data?: unknown): void } };
const schedules = (ctx: SaleContext) => ctx.storage["scheduled_sales"] as {
  get(id: string): Promise<ScheduledSale | null>; put(id: string, data: ScheduledSale): Promise<void>; delete(id: string): Promise<boolean>;
  query(options: { limit: number }): Promise<{ items: { id: string; data: ScheduledSale }[] }>;
};
const EDITOR = 40;
/**
 * Sells a page EmDash's timer published. Its record goes once the sale is written, or when Commerce refuses it (the page
 * sells nothing, or another page sells its product), which leaves a Draft for a person's publish to settle. Any other
 * failure keeps the record for the background check to try again.
 */
async function sellScheduled(ctx: SaleContext, pageId: string, held: ScheduledSale) {
  try {
    await setProductPageOnSale({ catalog: ctx.storage["catalog_items"] as never, pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages },
      { entryId: pageId, onSale: true, ...(held.name ? { name: held.name } : {}) });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    ctx.log.warn("Scheduled product page not put on sale", { pageId, code });
    if (code !== "CATALOG_ITEM_NOT_FOUND" && code !== "PRODUCT_PAGE_CONFLICT" && code !== "INVALID_INPUT") return;
  }
  await schedules(ctx).delete(pageId + ":e");
}
const sameTime = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && Date.parse(a) === Date.parse(b);

type PrivateRoute = Extract<NonNullable<SandboxedPlugin["routes"]>[string], { handler: unknown }>;
/** A private POST route for signed-in users holding the permission. */
const privatePost = (permission: PrivateRoute["permission"], handler: PrivateRoute["handler"]): PrivateRoute => ({ public: false, permission, methods: ["POST"], handler });

/** Tries again a sale EmDash's timer published and Commerce could not write, while the page is still published. */
async function retryScheduledSales(ctx: SaleContext & { content?: { get(collection: string, id: string): Promise<{ status: string } | null> } }) {
  for (const { id, data } of (await schedules(ctx).query({ limit: 50 })).items) {
    if (!data.go || !id.endsWith(":e")) continue;
    const pageId = id.slice(0, -2);
    if ((await ctx.content?.get("products", pageId))?.status === "published") await sellScheduled(ctx, pageId, data);
    else await schedules(ctx).delete(id);
  }
}

const plugin: SandboxedPlugin = {
  hooks: {
    // EmDash's own timer publishes a scheduled product page with nobody signed in, so Commerce sells it here, only on a
    // schedule an Editor or Admin set (scheduled-sale-in-commerce-20261122). A person's own publish goes through the
    // store's publish check instead. Every doubt leaves the product a Draft.
    "content:beforeSchedule": async ({ collection, content, actor, scheduledAt }, ctx) => {
      if (collection === "products") await schedules(ctx).put(content.id + ((actor?.role ?? 0) >= EDITOR ? ":e" : ":a"), { at: scheduledAt });
    },
    "content:beforePublish": async ({ collection, content, origin }, ctx) => {
      if (collection !== "products") return;
      const id = content.id as string, at = content.scheduledAt, editor = await schedules(ctx).get(id + ":e");
      // Anyone else's request for the same moment, which may be the one EmDash kept, withdraws the sale.
      const other = await schedules(ctx).get(id + ":a");
      await schedules(ctx).delete(id + ":a");
      if (origin.source === "scheduler" && sameTime(editor?.at, at) && !sameTime(other?.at, at)) {
        await schedules(ctx).put(id + ":e", { at, go: true, name: (content.data as { title?: unknown } | undefined)?.title });
      } else if (editor) await schedules(ctx).delete(id + ":e");
    },
    "content:afterPublish": async ({ collection, content }, ctx) => {
      const held = collection === "products" ? await schedules(ctx).get(content.id + ":e") : null;
      if (held?.go) await sellScheduled(ctx, content.id as string, held);
    },
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
        if (event.name === COMMERCE_CHECKOUT_WAKES_TASK) {
          await retryScheduledSales(ctx).catch(() => {});
          await refreshCheckoutSettings(ctx);
        }
        await installedCheckout.cron(event, ctx);
        if (event.name === COMMERCE_CHECKOUT_WAKES_TASK) {
          await syncOrdersWithShip(ctx).catch(() => {});
          await clearOldLookupGuesses(ctx).catch(() => {});
        }
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
    // DinkusKit.com reads a waiting Connect's receipt here, on the store's own web address.
    "store-proof": { public: true, methods: ["GET"], response: "raw", request: { body: "none" }, handler: (route, ctx) => storeProof(route.input, ctx) },
    admin: privatePost("content:edit_any", commerceAdmin),
    // The Dinkus Commerce panel on each Content > Products page.
    "product-panel": privatePost("content:edit_any", productPanel),
    "product-media-panel": privatePost("content:edit_any", productMediaPanel),
    // The store's publish check: a published product page puts its product on sale (catalog-product-states-20261023).
    [PRODUCT_PAGE_ON_SALE_ROUTE]: privatePost("content:publish_any", (route, ctx) => setProductPageOnSale({ catalog: ctx.storage["catalog_items"] as never,
      pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages, rows: ["catalog_prices", "catalog_manual_availability", "catalog_backorder_policies",
        "catalog_media", "product_feed_eligibility"].map(name => ctx.storage[name]!) }, route.input)),
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
    [GUEST_CHECKOUT_CART_ROUTE]: guestRoute(installedCheckout.cart),
    [GUEST_CHECKOUT_READINESS_ROUTE]: publicRead((route, ctx) => installedCheckout.readiness(route, ctx), ["origin"]),
    // The order lookup page: order number plus checkout email, from the store's own server page.
    [ORDER_LOOKUP_ROUTE]: pluginRoute({ public: true, methods: ["POST"], request: { body: "json", headers: ["origin", "sec-fetch-site"] }, cacheControl: "no-store", handler: lookUpOrder }),
  },
};
// Every route also registers the background check if switching on could not; after that it costs nothing.
for (const [name, route] of Object.entries(plugin.routes!)) {
  plugin.routes![name] = typeof route === "function" ? withBackgroundCheck(route) : { ...route, handler: withBackgroundCheck(route.handler) };
}
export default plugin;
