import type { SandboxedRouteContext } from 'emdash/plugin';
import { englishCouponCatalog } from './coupon-catalog.js';

type CatalogParts = ReadonlyArray<string | readonly [string]>;

/**
 * Format a pinned compiled catalog message. scripts/coupon-catalog.mjs refuses
 * any descriptor beyond plain strings and single-name placeholders, so this
 * matches @lingui/core for every message in the catalog without shipping its
 * runtime in the Registry artifact (tests/coupon-i18n.test.mjs proves equality).
 */
export function formatCouponMessage(
  catalog: Record<string, CatalogParts>,
  message: string,
  values?: Record<string, unknown>,
): string {
  // An uncatalogued message is split on its simple placeholders the same way.
  const parts = catalog[message] ?? message.split(/\{(\w+)\}/).map((part, index) => (index % 2 ? [part] : part));
  return parts.map((part) => (typeof part === 'string' ? part : String(values?.[part[0]] ?? ''))).join('');
}

export function couponText(_route: SandboxedRouteContext) {
  // The plugin currently ships an English source catalog. The host controls
  // locale and document direction; unsupported translations use English.
  return (message: string, values?: Record<string, unknown>) =>
    formatCouponMessage(englishCouponCatalog as Record<string, CatalogParts>, message, values);
}
