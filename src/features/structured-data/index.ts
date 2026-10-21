/**
 * Host-side structured data helpers.
 * GrillTrack jsonld-*-059 locked on PR #73 (comments 6067853218 + 6067895247).
 * Never import this module from src/plugin.ts or sandbox admin — keep it out of
 * the Registry backend byte budget.
 */
export { buildProductJsonLd } from "./builder.js";
export { buildProductPreviewJsonLd } from "./preview-builder.js";
export { mapAvailabilityToSchemaOrg } from "./availability.js";
export { formatMinorUnitsAsDecimal } from "./price.js";
export { assertProductJsonLdShape } from "./validate.js";
export type {
  BuildProductJsonLdInput,
  BuildProductPreviewJsonLdInput,
  JsonLdNode,
  ProductJsonLd,
  ProductPreviewJsonLd,
  StructuredAvailabilityStatus,
  StructuredMoney,
  StructuredPageFacts,
  StructuredPoliciesInput,
  StructuredProductInput,
  StructuredReturnPolicy,
  StructuredShippingPolicy,
} from "./types.js";
