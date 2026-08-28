import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const featureRoot = "src/features/catalog";
const requiredFiles = [
  "FEATURE_MAP.md",
  "bin/verify-commerce",
  "proof/catalog-first-managed-sku/PROOF.md",
  "proof/catalog-first-managed-sku/source-manifest.sha256",
  "src/index.ts",
  `${featureRoot}/index.ts`,
  `${featureRoot}/create-catalog-item.ts`,
  `${featureRoot}/storage-constraints.ts`,
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
    "`src/features/catalog/`",
    "`bin/verify-commerce quick`",
    "`bin/verify-commerce full`",
    "`proof/catalog-first-managed-sku/PROOF.md`",
  ]) {
    if (!map.includes(requiredText)) findings.push(`FEATURE_MAP.md is missing ${requiredText}`);
  }

  const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  if (manifest.exports?.["./features/catalog"]?.default !== "./dist/features/catalog/index.js") {
    findings.push("package export ./features/catalog must resolve to the catalog public entry");
  }
  if (manifest.devDependencies?.emdash !== "0.35.0") {
    findings.push("catalog pilot must remain pinned to exact emdash 0.35.0");
  }

  const sourceFiles = allFiles.filter((path) => path.startsWith("src/") && path.endsWith(".ts"));
  for (const path of sourceFiles) {
    if (path.startsWith(`${featureRoot}/`)) continue;
    const source = await readFile(join(repositoryRoot, path), "utf8");
    const internalImports = source.matchAll(/from\s+["']([^"']*features\/catalog\/[^"']+)["']/g);
    for (const match of internalImports) {
      if (!match[1].endsWith("/index.js")) {
        findings.push(`${path} bypasses the dinkus.catalog public entry: ${match[1]}`);
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
