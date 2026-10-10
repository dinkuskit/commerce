import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import {
  loadOutOfStockListing, setOutOfStockListing, loadStorefrontPlaceholderImage, setStorefrontPlaceholderImage,
  type StorefrontOutOfStockListingRecord, type StorefrontPlaceholderImageStorage,
} from "../features/storefront-availability/kernel/index.js";
import { merchantStoreSettingsBlocks } from "../features/store-settings/kernel/index.js";
import { navigation } from "../shared/admin-blocks.js";
import { alert, bool, button, failed, header, message, note, object, refused, text } from "./common.js";
import { preview, target } from "./media.js";

function placeholderStorage(ctx: PluginContext) {
  return ctx.storage["storefront_placeholder_image"] as StorefrontPlaceholderImageStorage;
}
function listingStorage(ctx: PluginContext) {
  return ctx.storage["storefront_out_of_stock_listing"] as StorageCollection<StorefrontOutOfStockListingRecord>;
}
async function placeholderBlocks(ctx: PluginContext): Promise<Block[]> {
  const placeholder = (await loadStorefrontPlaceholderImage(placeholderStorage(ctx))).image;
  return [
    header("Placeholder image"), note("Shown for products without an image."),
    await preview(ctx, placeholder, "Placeholder image"),
    { type: "actions", elements: [
      button(placeholder ? "Change placeholder" : "Choose placeholder", "media.pick", { t: "placeholder", id: "" }),
      ...(placeholder ? [button("Remove placeholder", "media.clear", { t: "placeholder", id: "" })] : []),
    ] },
  ];
}
function settingsResponse(hideOutOfStock: boolean, failure?: string): BlockResponse {
  return { blocks: [
    header("Commerce settings"), navigation(), header("Catalog"),
    ...(failure ? [alert(failure), note("Save not confirmed; choice kept.")] : []),
    { type: "form", block_id: "catalog-settings-" + crypto.randomUUID(), fields: [
      { type: "toggle", action_id: "hideOutOfStock", label: "Hide out-of-stock products", initial_value: hideOutOfStock },
    ], submit: { label: "Save", action_id: "settings.save" } },
  ] };
}
export async function settings(ctx: PluginContext, route: SandboxedRouteContext, toast?: string, merchant?: BlockResponse): Promise<BlockResponse> {
  const listing = await loadOutOfStockListing(listingStorage(ctx));
  const response = settingsResponse(listing.hideOutOfStock);
  return { blocks: [...response.blocks, ...await placeholderBlocks(ctx), ...(merchant ?? await merchantStoreSettingsBlocks({ ...route, input: { type: "page_load", page: "/settings" } }, ctx)).blocks], ...(toast ? { toast: { type: "success", message: toast } } : {}) };
}

/** Settings page interactions: the page itself, its placeholder image and the catalog listing toggle. */
export function settingsInteraction(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (value.type === "page_load") return value.page === "/settings";
  if (value.type === "form_submit") return value.action_id === "settings.save";
  return value.type === "block_action" && (value.action_id === "settings" ||
    (value.action_id === "media.use" || value.action_id === "media.clear") &&
    (value.value as { t?: unknown } | null)?.t === "placeholder");
}

export async function settingsAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const input = route.input as Record<string, unknown>;
  let values: Record<string, unknown> = {};
  try {
    if (input.type === "page_load" || (input.type === "block_action" && input.action_id === "settings")) return await settings(ctx, route);
    if (input.type === "block_action") {
      const v = object(input.value);
      target(v);
      const mediaId = input.action_id === "media.use" ? text(v.m) : null;
      await setStorefrontPlaceholderImage(placeholderStorage(ctx), { image: mediaId });
      return await settings(ctx, route, mediaId ? "Placeholder saved" : "Placeholder removed");
    }
    if (input.type === "form_submit") {
      values = object(input.values);
      await setOutOfStockListing(listingStorage(ctx), { hideOutOfStock: bool(values.hideOutOfStock) });
      return await settings(ctx, route, "Settings saved");
    }
    throw new Error("Unknown interaction");
  } catch (error) {
    const failure = message(error);
    // A refused placeholder choice returns the clerk to Settings with the reason; stored values are unchanged.
    if (input.type === "block_action" && input.action_id !== "settings") {
      try { return refused(failure, [alert(failure), ...(await settings(ctx, route)).blocks]); }
      catch { /* fall through to the generic alert */ }
    }
    if (input.type === "form_submit" && typeof values.hideOutOfStock === "boolean") {
      return refused(failure, settingsResponse(values.hideOutOfStock, failure).blocks);
    }
    return failed(failure);
  }
}
