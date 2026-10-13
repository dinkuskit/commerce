import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = join(here, "..");

const requiredRootFiles = [
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "FEATURE_MAP.md",
  "LICENSE",
  "README.md",
  "REPO_HYGIENE.md",
  "SECURITY.md",
  "VISION.md",
  "package.json",
  "bin/verify-commerce",
  "CHANGELOG.md",
  "RELEASING.md",
  ".changeset/config.json",
  "emdash-plugin.jsonc",
];

const forbiddenSegments = new Set([
  ".env",
  ".pi",
  "data",
  "node_modules",
  "plans",
  "runs",
]);

const ignoredPublicWalkDirectories = new Set([
  ".git",
  ".tmp",
  "coverage",
  "dist",
  "node_modules",
]);

async function walk(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredPublicWalkDirectories.has(entry.name)) continue;
    const relativePath = relative(root, join(directory, entry.name));
    // Ignored local GrillTrack working artifacts are not a public path.
    if (relativePath === ".grilltrack/work" || relativePath.startsWith(".grilltrack/work/")) {
      continue;
    }
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(root, absolute)));
    else paths.push(relativePath);
  }
  return paths;
}

export async function auditRepository(root = repositoryRoot) {
  const findings = [];
  const files = await walk(root);

  for (const required of requiredRootFiles) {
    if (!files.includes(required)) findings.push(`missing required file: ${required}`);
  }

  for (const path of files) {
    const segments = path.split("/");
    if (segments.some((segment) => forbiddenSegments.has(segment))) {
      findings.push(`forbidden public path: ${path}`);
    }
    if (segments.includes(".npmrc") && path !== ".npmrc") {
      findings.push(`forbidden public path: ${path}`);
    }
    if (segments.some((segment) => segment.startsWith(".env."))) {
      findings.push(`forbidden environment path: ${path}`);
    }
    if (path.endsWith(".sql")) findings.push(`forbidden SQL path: ${path}`);
  }

  if (files.includes(".npmrc")) {
    const npmrc = await readFile(join(root, ".npmrc"), "utf8");
    if (npmrc.trim() !== "engine-strict=true") {
      findings.push("root .npmrc must contain only engine-strict=true");
    }
  }

  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.name !== "@dinkuskit/commerce") {
    findings.push("package name must be @dinkuskit/commerce");
  }
  // Changesets owns the version from the 0.2.0 baseline on. The 0.x gate
  // stays until the explicit 1.0 decision; the plugin manifest must agree
  // with package.json or the plugin CLI refuses to publish.
  if (!/^0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) {
    findings.push("package version must stay on 0.x until the 1.0.0 gate");
  }
  if (files.includes("emdash-plugin.jsonc")) {
    const pluginManifest = await readFile(join(root, "emdash-plugin.jsonc"), "utf8");
    const pluginVersion = /"version":\s*"([^"]*)"/.exec(pluginManifest)?.[1];
    if (pluginVersion !== manifest.version) {
      findings.push("emdash-plugin.jsonc version must match package.json version");
    }
  }
  if (manifest.private !== undefined) findings.push("package must not be marked private for public release");
  if (manifest.license !== "MIT") findings.push("package license must be MIT");
  if (manifest.repository?.url !== "git+https://github.com/dinkuskit/commerce.git") {
    findings.push("package repository must be dinkuskit/commerce");
  }
  if (manifest.peerDependencies?.emdash !== "1.2.0") {
    findings.push("runtime peer must pin exact emdash 1.2.0");
  }
  const compatibility = manifest.dinkuskit?.emdashCompatibility;
  const requiredCompatibility = {
    apiPeer: "1.2.0",
    nodeEngine: ">=22.16.0 <23",
    packageIntegrity: "sha512-f9s7khWeuOxX5cRimlu9o224hn9TuKnYk/0Vsu1CS9oaVn78V1+MWyfEsZc2iDv8JYWrezEZFkpy/Q6pRgVgzg==",
    mountedSitePilot: "private",
    requiredSourceVisibility: "public",
    requiredSourceRepository: "https://github.com/emdash-cms/emdash",
    stockReleaseBehavior: "fail-closed",
    stableReleaseExit: "repin-and-rerun-compatibility-proof",
  };
  if (JSON.stringify(compatibility) !== JSON.stringify(requiredCompatibility)) {
    findings.push(
      "private mounted-site pilot must retain the exact EmDash fork compatibility contract",
    );
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(["dist", "emdash-plugin.jsonc", "cli"])) {
    findings.push("package files must contain only dist, emdash-plugin.jsonc and cli");
  }

  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = await auditRepository();
  if (findings.length) {
    for (const finding of findings) console.error(finding);
    process.exitCode = 1;
  } else {
    console.log("public_repository_contract=clean");
  }
}
