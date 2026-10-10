import type { BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import { merchantStoreSettingsBlocks, merchantStoreSettingsInteraction } from "../features/store-settings/kernel/index.js";
import { listPaidOrders, type CheckoutRecord } from "../features/checkout/kernel/index.js";
import { ordersBlocks, ordersInteraction } from "../features/orders/index.js";
import { productsAdmin } from "./products.js";
import { settings, settingsAdmin, settingsInteraction } from "./settings.js";

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
  });
  if (settingsInteraction(route.input)) return settingsAdmin(route, ctx);
  return productsAdmin(route, ctx);
}
