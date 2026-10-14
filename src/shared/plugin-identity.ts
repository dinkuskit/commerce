/** Exact installation identities derived from the Commerce publisher and slugs. */
export const INSTALLED_COMMERCE_PLUGIN_ID = "dinkus-commerce";
export const COMMERCE_REGISTRY_RUNTIME_ID = "r_gshdrqaldna3r7sn";
export const COMMERCE_BETA_REGISTRY_RUNTIME_ID = "r_fjzjvld3ssb4j63o";

export function isCommerceRegistryRuntimeId(value: unknown): boolean {
  return value === COMMERCE_REGISTRY_RUNTIME_ID || value === COMMERCE_BETA_REGISTRY_RUNTIME_ID;
}

export function isCommerceInstallationId(value: unknown): boolean {
  return value === INSTALLED_COMMERCE_PLUGIN_ID || isCommerceRegistryRuntimeId(value);
}
