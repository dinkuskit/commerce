import type { Block, BlockResponse } from "@emdash-cms/blocks/server";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";

import { loadMerchantStoreSettings, saveMerchantStoreSettings } from "../operations.js";
import { merchantStoreSettingsAuthorized } from "../authorization.js";
import { StoreSettingsError, type MerchantStoreSettings } from "../types.js";
import { DEFAULT_SETTINGS } from "../normalize.js";

const ACTION = "merchant-store-settings.save";
const BLOCK_PREFIX = "merchant-store-settings:";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreSettingsError("INVALID_INPUT", "invalid admin interaction");
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 4096) throw new StoreSettingsError("INVALID_INPUT", `${field} is invalid`);
  return value;
}

function list(value: unknown, field: string): string[] {
  const source = text(value, field);
  return source.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
}

function revisionFrom(input: Record<string, unknown>): string | null {
  const blockId = typeof input.block_id === "string" ? input.block_id : "";
  if (!blockId.startsWith(BLOCK_PREFIX)) throw new StoreSettingsError("INVALID_INPUT", "missing settings revision");
  const encoded = blockId.slice(BLOCK_PREFIX.length);
  return encoded === "null" ? null : encoded;
}

function valuesFor(settings: MerchantStoreSettings): Record<string, unknown> {
  return {
    storeCountry: settings.storeCountry ?? "",
    sellingCountries: settings.sellingCountries.join(", "),
    shippingCountries: settings.shippingCountries.join(", "),
    requirePhoneNumber: settings.requirePhoneNumber,
  };
}

export function merchantStoreSettingsInteraction(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const action = (input as Record<string, unknown>).action_id;
  return action === ACTION || action === "merchant-store-settings";
}

function response(settings: MerchantStoreSettings, revision: string | null, notice?: { title: string; variant: "default" | "error" }, draft?: Record<string, unknown>): BlockResponse {
  const values = draft ?? valuesFor(settings);
  const blocks: Block[] = [
    { type: "header", text: "Merchant store settings" },
    { type: "context", text: "Checkout does not enforce country eligibility yet. Selling/customer countries and physical shipping destinations are independent." },
    { type: "context", text: settings.storeCountry === null ? "Choose your store country. On the first country save, blank lists default to that country. Extra countries must be added explicitly. You can save the phone setting before choosing a country." : "Changing the store country preserves your lists. A blank list means no enabled countries or destinations." },
  ];
  if (notice) blocks.push({ type: "banner", title: notice.title, variant: notice.variant });
  blocks.push({
    type: "form",
    block_id: `${BLOCK_PREFIX}${revision ?? "null"}`,
    fields: [
      { type: "text_input", action_id: "storeCountry", label: "Store country (ISO alpha-2 code)", placeholder: "e.g. CA", initial_value: String(values.storeCountry ?? "") },
      { type: "text_input", action_id: "sellingCountries", label: "Allowed selling/customer countries (comma-separated codes)", placeholder: "Leave empty for no enabled countries", initial_value: String(values.sellingCountries ?? "") },
      { type: "text_input", action_id: "shippingCountries", label: "Allowed physical shipping destinations (comma-separated codes)", placeholder: "Leave empty for no enabled destinations", initial_value: String(values.shippingCountries ?? "") },
      { type: "toggle", action_id: "requirePhoneNumber", label: "Require a phone number", description: "Require customers to include a phone number at checkout.", initial_value: values.requirePhoneNumber === true },
    ],
    submit: { label: "Save merchant settings", action_id: ACTION },
  });
  return { blocks };
}

export async function merchantStoreSettingsBlocks(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  if (!merchantStoreSettingsAuthorized(route)) {
    throw new StoreSettingsError("UNAUTHORIZED", "Merchant store settings require an authenticated editor admin");
  }
  const input = object(route.input);
  if (input.type === "page_load" || input.action_id === "merchant-store-settings") {
    const loaded = await loadMerchantStoreSettings(ctx.settings);
    return response(loaded.settings, loaded.revision);
  }
  if (input.type !== "form_submit" || input.action_id !== ACTION) throw new StoreSettingsError("INVALID_INPUT", "unknown merchant settings interaction");
  const draft = object(input.values);
  const revision = revisionFrom(input);
  let current;
  try { current = await loadMerchantStoreSettings(ctx.settings); }
  catch (error) {
    if (!(error instanceof StoreSettingsError)) throw error;
    return response(DEFAULT_SETTINGS, revision, { title: error.message, variant: "error" }, draft);
  }
  try {
    const countryValue = text(draft.storeCountry, "storeCountry").trim();
    if (!countryValue && current.settings.storeCountry !== null) {
      throw new StoreSettingsError("INVALID_INPUT", "Store country is required");
    }
    const selling = list(draft.sellingCountries, "sellingCountries");
    const shipping = list(draft.shippingCountries, "shippingCountries");
    const first = current.settings.storeCountry === null;
    const raw = {
      ...(countryValue ? { storeCountry: countryValue } : {}),
      ...(!first || selling.length ? { sellingCountries: selling } : {}),
      ...(!first || shipping.length ? { shippingCountries: shipping } : {}),
      requirePhoneNumber: draft.requirePhoneNumber,
      expectedRevision: revision,
    };
    const saved = await saveMerchantStoreSettings(ctx.settings, raw);
    return response(saved.settings, saved.revision, { title: "Merchant settings saved", variant: "default" });
  } catch (error) {
    if (!(error instanceof StoreSettingsError)) throw error;
    const failed = response(current.settings, revision, { title: error.message, variant: "error" }, draft);
    if (error.code === "CONFLICT") failed.blocks.push({ type: "actions", elements: [
      { type: "button", label: "Reload saved settings", action_id: "merchant-store-settings" },
    ] });
    return failed;
  }
}
