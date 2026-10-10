import { sortedKeys } from "../../shared/record.js";
import { GuestCheckoutError } from "./errors.js";

/** Shared fail-closed guards for Registry checkout configuration, passes and wakes. */
export function registryUnavailable(): never { throw new GuestCheckoutError("UNAVAILABLE"); }
export function registryText(value: unknown, limit = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && value.trim() === value;
}
export function exactKeys(value: Record<string, unknown>, expected: string): boolean {
  return sortedKeys(value) === expected;
}
