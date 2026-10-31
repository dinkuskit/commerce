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
  return refused(failure, [navigation(), alert(failure)]);
}
// Repeated Block Kit shapes, kept in one place because this admin ships in the backend.
export function header(text: string): Block {
  return { type: "header", text };
}
export function note(text: string): Block {
  return { type: "context", text };
}
type Choice = { readonly label: string; readonly value: string };
export const input = (action_id: string, label: string, initial_value?: string) =>
  ({ type: "text_input" as const, action_id, label, ...(initial_value === undefined ? {} : { initial_value }) });
export const radio = (action_id: string, label: string, options: readonly Choice[], initial_value?: string) =>
  ({ type: "radio" as const, action_id, label, options: [...options], ...(initial_value === undefined ? {} : { initial_value }) });
/** A form block id no earlier page load used, so a stale form never resubmits. */
export const fresh = (prefix: string) => prefix + crypto.randomUUID();
export const submit = (label: string, action_id: string) => ({ label, action_id });
export const toggle = (action_id: string, label: string, initial_value: boolean) => ({ type: "toggle" as const, action_id, label, initial_value });
export function button(label: string, action_id: string, value?: unknown) {
  return { type: "button" as const, label, action_id, ...(value === undefined ? {} : { value }) };
}
/** The error page an area returns with its own recovered blocks. */
export function refused(failure: string, blocks: Block[]): BlockResponse {
  return { blocks, toast: { type: "error", message: failure } };
}
