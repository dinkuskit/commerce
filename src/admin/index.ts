import type { BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import { loadCheckoutContactRequirements, merchantStoreSettingsBlocks, merchantStoreSettingsInteraction } from "../features/store-settings/kernel/index.js";
import { resolveCatalogVariantMember, type CatalogStorageRecord } from "../features/catalog/kernel/index.js";
import { listPaidOrders, resolveRegistryShip, type CheckoutRecord } from "../features/checkout/kernel/index.js";
import { ordersBlocks, ordersInteraction, shipLabelPage, syncShip, type OrdersCollection } from "../features/orders/index.js";
import { productsAdmin } from "./products.js";
import { settings, settingsAdmin, settingsInteraction } from "./settings.js";
import { connectAdmin, connectInteraction } from "./connect.js";

/** Brings Orders and Ship up to date when the store has a Ship service; each line's weight comes from Catalog. */
export async function syncOrdersWithShip(ctx: PluginContext): Promise<void> {
  const ship = await resolveRegistryShip(ctx);
  const catalog = ctx.storage["catalog_items"] as StorageCollection<CatalogStorageRecord>;
  if (ship) await syncShip(ctx.storage["orders"] as OrdersCollection, ship, async id => {
    const found = await resolveCatalogVariantMember(catalog, id);
    return found && { physical: (found.member?.fulfillment ?? found.item.fulfillment ?? "physical") === "physical", weightOz: found.item.weightOz };
  });
}

/**
 * Private Block Kit transport. The host authenticates and authorizes this
 * route. Each area owns its pages; this shell only routes to them and wires
 * the Checkout to Orders handoff for bringing in missing orders.
 */
export async function commerceAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  if (merchantStoreSettingsInteraction(route.input)) {
    const merchant = await merchantStoreSettingsBlocks(route, ctx);
    try { return await settings(ctx, route, undefined, merchant); }
    catch { return merchant; }
  }
  if (ordersInteraction(route.input)) return ordersBlocks(route, ctx, {
    paidOrders: () => listPaidOrders(ctx.storage["checkout_carts"] as StorageCollection<CheckoutRecord>),
    shippingCountries: async () => (await loadCheckoutContactRequirements(ctx.settings)).shippingCountries,
    ship: () => syncOrdersWithShip(ctx),
    labelPage: async id => {
      const ship = await resolveRegistryShip(ctx);
      const record = await (ctx.storage['orders'] as OrdersCollection).get(id);
      if (!ship || !record || record.shipPin) return undefined;
      return shipLabelPage(ship, id);
    },
  });
  if (connectInteraction(route.input)) return connectAdmin(route, ctx);
  if (settingsInteraction(route.input)) return settingsAdmin(route, ctx);
  return productsAdmin(route, ctx);
}
