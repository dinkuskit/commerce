/**
 * Host-side structured data helpers.
 * Provisional pending Ryan lock of GrillTrack jsonld-*-059 decisions.
 * Never import this module from src/plugin.ts or sandbox admin — keep it out of
 * the Registry backend byte budget.
 */
export { buildProductJsonLd } from "./builder.js";
export { mapAvailabilityToSchemaOrg } from "./availability.js";
export { formatMinorUnitsAsDecimal } from "./price.js";
export { assertProductJsonLdShape } from "./validate.js";
export type {
  BuildProductJsonLdInput,
  JsonLdNode,
  ProductJsonLd,
  StructuredAvailabilityStatus,
  StructuredMoney,
  StructuredPageFacts,
  StructuredPoliciesInput,
  StructuredProductInput,
  StructuredReturnPolicy,
  StructuredShippingPolicy,
} from "./types.js";
