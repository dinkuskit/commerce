import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";
import { CATALOG_API_ROUTE, catalogApi, commerceAdmin, productMediaPanel, productPanel, syncOrdersWithShip } from "./admin/index.js";
import { pageProduct, PRODUCT_PAGE_ON_SALE_ROUTE, PRODUCT_PAGES_COLLECTION, PRODUCT_ROW_COLLECTIONS, setProductPageOnSale, type ProductPages } from "./features/catalog/kernel/index.js";
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
  CHECKOUT_ADDONS_ROUTE,
  cancelKey,
  refreshCheckoutSettings,
  refuseStoppedCartEmail,
  resolveRegistryCheckoutServices,
  storeProof,
  withBackgroundCheck,
} from "./features/checkout/kernel/index.js";
import { COURIER_OUTBOX_ROUTE, courierOutbox, refuse, ORDER_LOOKUP_ROUTE, ORDER_NUMBERS_COLLECTION, ORDERS_API_ROUTE, ORDERS_COLLECTION, clearOldLookupGuesses, createPaidOrderReceiver, lookUpOrder, ordersApi, type OrderNumbers, type OrdersCollection } from "./features/orders/index.js";

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
 * Each schedule request for a Products page is its own record, `<page>@<moment>:e` from an Editor or Admin and
 * `<page>@<moment>:a` from anyone else, so no request can overwrite another. `<page>:go` is a sale EmDash's timer
 * published: the product the page sold then, that product's revision then, and the title to sell under.
 */
type ScheduledSale = { page: string; go?: true; name?: unknown; item?: string; fence?: string };
type SaleContext = { storage: Record<string, unknown>; log: { warn(message: string, data?: unknown): void };
  content?: { get(collection: string, id: string): Promise<{ status: string } | null> } };
const schedules = (ctx: SaleContext) => ctx.storage["scheduled_sales"] as {
  get(id: string): Promise<ScheduledSale | null>; put(id: string, data: ScheduledSale): Promise<void>; delete(id: string): Promise<boolean>;
  deleteMany(ids: string[]): Promise<number>;
  query(options: { where: Partial<ScheduledSale>; limit: number }): Promise<{ items: { id: string; data: ScheduledSale }[] }>;
};
const shelf = (ctx: SaleContext) => ({ catalog: ctx.storage["catalog_items"] as Parameters<typeof setProductPageOnSale>[0]["catalog"], pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages,
  rows: PRODUCT_ROW_COLLECTIONS.map(name => ctx.storage[name]!) as never });
const EDITOR = 40;
const moment = (at: unknown) => `@${Date.parse(String(at))}:`;
/**
 * Sells a page EmDash's timer published, while the page is still published, and only if nothing has changed its
 * product since the timer published it: a withdrawal, a person's sale or any other edit since moves the product's
 * revision, and the sale is refused at the write, so a later decision always wins. Its record goes once the sale is
 * written or refused (the product changed, the page sells nothing, or another page sells it), which leaves a Draft for
 * a person's publish to settle. Any other failure keeps the record for the background check to try again.
 */
async function sellScheduled(ctx: SaleContext, held: ScheduledSale) {
  try {
    if ((await ctx.content?.get("products", held.page))?.status === "published") await setProductPageOnSale(shelf(ctx),
      { entryId: held.page, catalogItemId: held.item, onSale: true, ...(held.name ? { name: held.name } : {}) }, { revision: held.fence! });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    ctx.log.warn("Scheduled product page not put on sale", { pageId: held.page, code });
    if (!["CATALOG_ITEM_NOT_FOUND", "PRODUCT_PAGE_CONFLICT", "INVALID_INPUT", "COMMAND_CONFLICT"].includes(code as string)) return;
  }
  await schedules(ctx).delete(held.page + ":go");
}

type PrivateRoute = Extract<NonNullable<SandboxedPlugin["routes"]>[string], { handler: unknown }>;
/** A private POST route for signed-in users holding the permission. */
const privatePost = (permission: PrivateRoute["permission"], handler: PrivateRoute["handler"]): PrivateRoute => ({ public: false, permission, methods: ["POST"], handler });

/**
 * Finishes one permanent delete that stopped halfway each run, after checkout's own work: its product is still held,
 * off the shop, by the page that is gone for good. It goes through the page, as the delete itself does, so a panel pick
 * the page held is finished too. Shopify likewise finishes a product delete in the background, and WooCommerce leaves
 * the owner a tool to clear what a stopped delete left (catalog-permanent-delete-20261122).
 */
async function finishDeletes(ctx: SaleContext) {
  const items = ctx.storage["catalog_items"] as { query(options: { where: { deleting: true }; limit: number }): Promise<{ items: { id: string; data: { pageId: string } }[] }> };
  for (const { id, data: { pageId } } of (await items.query({ where: { deleting: true }, limit: 1 })).items) {
    const linked = (await shelf(ctx).pages.query({ where: { entryId: pageId }, limit: 10 })).items.some(row => row.data.catalogItemId === id);
    await setProductPageOnSale(shelf(ctx), { ...linked ? {} : { catalogItemId: id }, entryId: pageId, onSale: false, deleted: true });
  }
}

/** Tries again one sale EmDash's timer published and Commerce could not save, each run, so a run stays small. */
async function retryScheduledSales(ctx: SaleContext) {
  for (const { data } of (await schedules(ctx).query({ where: { go: true }, limit: 1 })).items) await sellScheduled(ctx, data);
}

const plugin: SandboxedPlugin = {
  hooks: {
    // EmDash's own timer publishes a scheduled product page with nobody signed in, so Commerce sells it here, only on a
    // schedule an Editor or Admin set (scheduled-sale-in-commerce-20261122). A person's own publish goes through the
    // store's publish check instead. Every doubt leaves the product a Draft.
    "content:beforeSchedule": async ({ collection, content, actor, scheduledAt }, ctx) => {
      const page = content.id as string;
      if (collection === "products") await schedules(ctx).put(page + moment(scheduledAt) + ((actor?.role ?? 0) >= EDITOR ? "e" : "a"), { page });
    },
    "content:beforePublish": async ({ collection, content, origin }, ctx) => {
      if (collection !== "products") return;
      const page = content.id as string, asked = (kind: string) => schedules(ctx).get(page + moment(content.scheduledAt) + kind);
      // Anyone else's request for the same moment, which may be the one EmDash kept, withdraws the sale.
      const go = origin.source === "scheduler" && !!await asked("e") && !await asked("a");
      // Every request for the page ends with this publish, cleared in one call however many there were.
      await schedules(ctx).deleteMany((await schedules(ctx).query({ where: { page }, limit: 100 })).items.filter(({ data }) => !data.go).map(({ id }) => id));
      // The sale is of the product the page picks now, at its revision now.
      const item = go ? await pageProduct(shelf(ctx).pages, page) : undefined, stored = item && await shelf(ctx).catalog.getVersioned(item);
      if (stored) await schedules(ctx).put(page + ":go", { page, go: true, item, fence: "catalog:" + stored.revision, name: (content.data as { title?: unknown } | undefined)?.title });
      else await schedules(ctx).delete(page + ":go");
    },
    "content:afterPublish": async ({ collection, content }, ctx) => {
      const held = collection === "products" ? await schedules(ctx).get(content.id + ":go") : null;
      if (held) await sellScheduled(ctx, held);
    },
    // A cart email that was waiting or being retried when its shopper stopped cart emails is refused at send time
    // (cart-email-stop-at-send-20261123). Throwing, not returning false, lets the sender see it was not sent.
    "email:beforeSend": refuseStoppedCartEmail,
    // Switched on: the site's EmDash scheduler runs the background check every 5 minutes. If the
    // scheduler fails or stalls here, the next request registers it instead (see routes below).
    "plugin:activate": async (_event, ctx) => {
      await ensureBackgroundCheck(ctx, true);
    },
    // Uninstall cancels only Commerce's DinkusKit key (connect-uninstall-cancels-key-134); the store and the other plugins' keys stay.
    "plugin:uninstall": async (_event, ctx) => { await cancelKey(ctx); },
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
          await finishDeletes(ctx).catch(() => {});
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
    [PRODUCT_PAGE_ON_SALE_ROUTE]: privatePost("content:publish_any", (route, ctx) => setProductPageOnSale(shelf(ctx as never), route.input)),
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
    // The store's own code starts checkout here with the add-ons' answers (commerce-addons-door-20261124); it refuses anyone signed in.
    [CHECKOUT_ADDONS_ROUTE]: pluginRoute({ public: false, permission: "plugins:manage", methods: ["POST"], request: guestRequest,
      handler: (route, ctx) => {
        if (route.user) throw refuse("STORE_ONLY", "Only the store's own code may use this door.", 403);
        return installedCheckout.start(route as never, ctx, true);
      } }),
    [GUEST_CHECKOUT_READINESS_ROUTE]: publicRead((route, ctx) => installedCheckout.readiness(route, ctx), ["origin"]),
    // The order lookup page: order number plus checkout email, from the store's own server page.
    // The store's courier reads shipped orders here for Reviews (order-shipped-outbox-20261122); it refuses anyone signed in.
    [COURIER_OUTBOX_ROUTE]: privatePost("plugins:manage", courierOutbox),
    [ORDER_LOOKUP_ROUTE]: pluginRoute({ public: true, methods: ["POST"], request: { body: "json", headers: ["origin", "sec-fetch-site"] }, cacheControl: "no-store", handler: lookUpOrder }),
  },
};
// Every route also registers the background check if switching on could not; after that it costs nothing.
for (const [name, route] of Object.entries(plugin.routes!)) {
  plugin.routes![name] = typeof route === "function" ? withBackgroundCheck(route) : { ...route, handler: withBackgroundCheck(route.handler) };
}
export default plugin;
