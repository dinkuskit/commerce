import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
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
  "src/features/catalog/storage-constraints.ts",
  "src/features/inventory-provider/index.ts",
  "src/features/inventory-provider/binding.ts",
  "src/features/inventory-provider/stock-management.ts",
  "src/features/inventory-setup/index.ts",
  "src/features/inventory-setup/configure-inventory.ts",
  "src/features/inventory-setup/store-configuration.ts",
  "docs/implementation/managed-stock-foundation.md",
  "docs/implementation/configure-inventory-action.md",
  "proof/configure-inventory-action/PROOF.md",
  "proof/configure-inventory-action/source-manifest.sha256",
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
    "`src/features/catalog/`",
    "`src/features/inventory-provider/`",
    "`src/features/inventory-setup/`",
    "`bin/verify-commerce quick`",
    "`bin/verify-commerce full`",
    "`proof/catalog-first-managed-sku/PROOF.md`",
    "`proof/configure-inventory-action/PROOF.md`",
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
    manifest.exports?.["./features/inventory-setup"]?.default !==
    "./dist/features/inventory-setup/index.js"
  ) {
    findings.push(
      "package export ./features/inventory-setup must resolve to the inventory-setup public entry",
    );
  }
  if (manifest.devDependencies?.emdash !== "0.35.0") {
    findings.push("catalog pilot must remain pinned to exact emdash 0.35.0");
  }

  const sourceFiles = allFiles.filter((path) => path.startsWith("src/") && path.endsWith(".ts"));
  for (const path of sourceFiles) {
    const source = await readFile(join(repositoryRoot, path), "utf8");
    const sourceFeature = path.match(/^src\/features\/([^/]+)\//)?.[1];
    const imports = source.matchAll(/from\s+["']([^"']+)["']/g);
    for (const match of imports) {
      const importPath = match[1];
      const importedFeature = ["catalog", "inventory-provider", "inventory-setup"].find(
        (feature) =>
          importPath.includes(`/features/${feature}/`) || importPath.includes(`/${feature}/`),
      );
      if (
        importedFeature &&
        importedFeature !== sourceFeature &&
        !importPath.endsWith("/index.js")
      ) {
        findings.push(`${path} bypasses the ${importedFeature} public entry: ${importPath}`);
      }
    }
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
