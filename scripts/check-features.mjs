import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "FEATURE_MAP.md",
  "bin/verify-commerce",
  "proof/catalog-first-managed-sku/PROOF.md",
  "proof/catalog-first-managed-sku/source-manifest.sha256",
  "proof/managed-stock-foundation/PROOF.md",
  "proof/managed-stock-foundation/live-runtime.txt",
  "proof/managed-stock-foundation/source-manifest.sha256",
  "src/index.ts",
  "src/features/catalog/index.ts",
  "src/features/catalog/create-catalog-item.ts",
  "src/features/catalog/manual-availability.ts",
  "src/features/catalog/money.ts",
  "src/features/catalog/price.ts",
  "src/features/catalog/storage-constraints.ts",
  "src/features/inventory-provider/index.ts",
  "src/features/inventory-provider/binding.ts",
  "src/features/inventory-provider/stock-management.ts",
  "src/features/inventory-setup/index.ts",
  "src/features/inventory-setup/configure-inventory.ts",
  "src/features/inventory-setup/store-configuration.ts",
  "src/features/storefront-availability/index.ts",
  "src/features/checkout/index.ts",
  "src/features/checkout/kernel/index.ts",
  "src/features/coupons/index.ts",
  "src/features/orders/index.ts",
  "docs/contracts/commerce-handoffs.md",
  "src/features/store-policies/index.ts",
  "src/features/structured-data/index.ts",
  "docs/implementation/product-jsonld-policies.md",
  "docs/implementation/guest-checkout-public.md",
  "docs/implementation/checkout-payment-window.md",
  "src/features/storefront-availability/policy.ts",
  "src/features/storefront-availability/resolve.ts",
  "src/features/storefront-availability/settings.ts",
  "docs/implementation/managed-stock-foundation.md",
  "docs/implementation/configure-inventory-action.md",
  "docs/implementation/managed-storefront-availability.md",
  "docs/implementation/unmanaged-product-sellability.md",
  "docs/implementation/commerce-owned-product-price.md",
  "proof/configure-inventory-action/PROOF.md",
  "proof/configure-inventory-action/source-manifest.sha256",
  "proof/managed-storefront-availability/PROOF.md",
  "proof/managed-storefront-availability/source-manifest.sha256",
  "proof/unmanaged-product-sellability/PROOF.md",
  "proof/unmanaged-product-sellability/live-runtime.txt",
  "proof/unmanaged-product-sellability/source-manifest.sha256",
  "proof/commerce-owned-product-price/PROOF.md",
  "proof/commerce-owned-product-price/live-runtime.txt",
  "proof/commerce-owned-product-price/source-manifest.sha256",
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".tmp", "dist", "node_modules"].includes(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

/**
 * A feature reaches another feature only through that feature's index.ts
 * (its public or kernel entry). Shared contracts in src/handoffs/ and helpers
 * in src/shared/ are open to every feature.
 */
export function frontDoorFindings(path, source, sourceFeature, features) {
  const findings = [];
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const importPath = match[1];
    if (!importPath.startsWith(".")) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(path), importPath));
    const importedFeature = resolved.match(/^src\/features\/([^/]+)\//)?.[1];
    if (!importedFeature || importedFeature === sourceFeature || !features.includes(importedFeature)) continue;
    if (!resolved.endsWith("/index.js")) {
      findings.push(`${path} bypasses the ${importedFeature} public entry: ${importPath}`);
    }
  }
  return findings;
}

/**
 * Registry storage collections and the feature that owns each. Only the owner,
 * the composition roots and the admin shell may name one. Anything else is a
 * feature reading another feature's private storage, which a split into
 * separate plugins cannot carry.
 */
export const STORAGE_OWNERS = {
  catalog_items: "catalog", catalog_prices: "catalog", catalog_backorder_policies: "catalog",
  catalog_manual_availability: "catalog", catalog_media: "catalog",
  product_feed_eligibility: "feeds",
  managed_sku_claims: "inventory-provider",
  store_inventory_configurations: "inventory-setup",
  storefront_availability_settings: "storefront-availability",
  storefront_out_of_stock_listing: "storefront-availability",
  storefront_placeholder_image: "storefront-availability",
  checkout_carts: "checkout", checkout_guest_capabilities: "checkout", checkout_payment_associations: "checkout",
  store_shipping_policy: "store-policies", store_return_policy: "store-policies",
  orders: "orders",
};
const STORAGE_COMPOSITION = ["src/plugin.ts", "src/index.ts"];
/**
 * Known crossings, kept until each is replaced by a written handoff (see
 * docs/contracts/commerce-handoffs.md). This list may only shrink.
 */
export const KNOWN_STORAGE_CROSSINGS = {
  // Checkout binds the Catalog-side storage that answers its Catalog quote.
  "src/features/checkout/runtime.ts": [
    "catalog_items", "catalog_prices", "catalog_backorder_policies", "catalog_manual_availability",
    "store_inventory_configurations", "storefront_availability_settings", "storefront_out_of_stock_listing",
  ],
};
export function storageFindings(path, source, sourceFeature) {
  if (STORAGE_COMPOSITION.includes(path) || path.startsWith("src/admin/")) return [];
  const findings = [];
  for (const match of source.matchAll(/["']([a-z_]+)["']/g)) {
    const owner = STORAGE_OWNERS[match[1]];
    if (!owner || owner === sourceFeature) continue;
    if (KNOWN_STORAGE_CROSSINGS[path]?.includes(match[1])) continue;
    findings.push(`${path} names ${owner} storage ${match[1]}; go through a handoff instead`);
  }
  return findings;
}

export async function auditFeatures(repositoryRoot = root) {
  const findings = [];
  const allFiles = (await walk(repositoryRoot)).map((path) => relative(repositoryRoot, path));
  for (const required of requiredFiles) {
    if (!allFiles.includes(required)) findings.push(`missing feature contract file: ${required}`);
  }

  const map = await readFile(join(repositoryRoot, "FEATURE_MAP.md"), "utf8");
  for (const requiredText of [
    "`dinkus.catalog`",
    "`dinkus.inventory-provider`",
    "`dinkus.inventory-setup`",
    "`dinkus.storefront-availability`",
    "`dinkus.checkout`",
    "`dinkus.orders`",
    "`dinkus.store-policies`",
    "`dinkus.structured-data`",
    "`src/features/catalog/`",
    "`src/features/inventory-provider/`",
    "`src/features/inventory-setup/`",
    "`src/features/storefront-availability/`",
    "`src/features/checkout/`",
    "`src/features/orders/`",
    "`src/features/coupons/`",
    "`src/features/store-policies/`",
    "`src/features/structured-data/`",
    "`bin/verify-commerce quick`",
    "`bin/verify-commerce full`",
    "`proof/catalog-first-managed-sku/PROOF.md`",
    "`proof/configure-inventory-action/PROOF.md`",
    "`proof/managed-storefront-availability/PROOF.md`",
    "`proof/unmanaged-product-sellability/PROOF.md`",
    "`proof/commerce-owned-product-price/PROOF.md`",
  ]) {
    if (!map.includes(requiredText)) findings.push(`FEATURE_MAP.md is missing ${requiredText}`);
  }

  const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  if (manifest.exports?.["./features/catalog"]?.default !== "./dist/features/catalog/index.js") {
    findings.push("package export ./features/catalog must resolve to the catalog public entry");
  }
  if (
    manifest.exports?.["./features/inventory-provider"]?.default !==
    "./dist/features/inventory-provider/index.js"
  ) {
    findings.push(
      "package export ./features/inventory-provider must resolve to the inventory-provider public entry",
    );
  }
  if (
    manifest.exports?.["./features/storefront-availability"]?.default !==
    "./dist/features/storefront-availability/index.js"
  ) {
    findings.push(
      "package export ./features/storefront-availability must resolve to the storefront-availability public entry",
    );
  }
  if (
    manifest.exports?.["./features/inventory-setup"]?.default !==
    "./dist/features/inventory-setup/index.js"
  ) {
    findings.push(
      "package export ./features/inventory-setup must resolve to the inventory-setup public entry",
    );
  }
  if (
    manifest.exports?.["./features/coupons"]?.default !==
    "./dist/features/coupons/index.js"
  ) {
    findings.push(
      "package export ./features/coupons must resolve to the coupons public entry",
    );
  }
  if (
    manifest.exports?.["./features/store-policies"]?.default !==
    "./dist/features/store-policies/index.js"
  ) {
    findings.push(
      "package export ./features/store-policies must resolve to the store-policies public entry",
    );
  }
  if (
    manifest.exports?.["./features/structured-data"]?.default !==
    "./dist/features/structured-data/index.js"
  ) {
    findings.push(
      "package export ./features/structured-data must resolve to the structured-data public entry",
    );
  }
  if (manifest.devDependencies?.emdash !== "1.2.0") {
    findings.push("catalog pilot must remain pinned to exact emdash 1.2.0");
  }

  // Every folder under src/features is a feature, so a new one is covered the day it lands.
  const features = (await readdir(join(repositoryRoot, "src/features"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const sourceFiles = allFiles.filter((path) => path.startsWith("src/") && path.endsWith(".ts"));
  for (const path of sourceFiles) {
    const source = await readFile(join(repositoryRoot, path), "utf8");
    const sourceFeature = path.match(/^src\/features\/([^/]+)\//)?.[1];
    for (const finding of frontDoorFindings(path, source, sourceFeature, features)) findings.push(finding);
    for (const finding of storageFindings(path, source, sourceFeature)) findings.push(finding);
  }

  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = await auditFeatures();
  if (findings.length) {
    for (const finding of findings) console.error(finding);
    process.exitCode = 1;
  } else {
    console.log("feature_contract=clean");
  }
}
