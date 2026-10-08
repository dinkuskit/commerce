import type { StructuredAvailabilityStatus } from "./types.js";

/**
 * Locked mapping (PR #73 comments 6067853218 + 6067895247 / 6067898015):
 * - in-stock → InStock
 * - low-stock → LimitedAvailability
 * - out-of-stock → OutOfStock
 * - available-on-backorder → BackOrder
 * - availability-unavailable → OutOfStock (emit Offer; never omit; never InStock)
 */
export function mapAvailabilityToSchemaOrg(
  status: StructuredAvailabilityStatus,
): `https://schema.org/${string}` {
  switch (status) {
    case "in-stock":
      return "https://schema.org/InStock";
    case "low-stock":
      return "https://schema.org/LimitedAvailability";
    case "out-of-stock":
      return "https://schema.org/OutOfStock";
    case "available-on-backorder":
      return "https://schema.org/BackOrder";
    case "availability-unavailable":
      return "https://schema.org/OutOfStock";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
