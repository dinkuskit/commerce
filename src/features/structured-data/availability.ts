import type { StructuredAvailabilityStatus } from "./types.js";

/**
 * Provisional mapping (GrillTrack jsonld-availability-*-059, pending Ryan lock):
 * - in-stock → InStock
 * - low-stock → LimitedAvailability
 * - out-of-stock → OutOfStock
 * - available-on-backorder → BackOrder
 * - availability-unavailable → OutOfStock (never InStock)
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
