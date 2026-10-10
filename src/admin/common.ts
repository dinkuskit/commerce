import type { Block, BlockResponse } from "@emdash-cms/blocks";
import { CatalogError } from "../features/catalog/kernel/index.js";
import { StorefrontAvailabilityError } from "../features/storefront-availability/kernel/index.js";
import { navigation } from "../shared/admin-blocks.js";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid form");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024) throw new Error("Invalid field");
  return value;
}
export function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid checkbox");
  return value;
}
export function message(error: unknown): string {
  return error instanceof CatalogError || error instanceof StorefrontAvailabilityError
    ? error.message : "Could not complete. Reload and retry.";
}
export function alert(message: string): Block {
  return { type: "banner", title: message, variant: "error" };
}

/** Render-only fallback when an area cannot recover its own page. */
export function failed(failure: string): BlockResponse {
  return { blocks: [navigation(), alert(failure)], toast: { type: "error", message: failure } };
}
