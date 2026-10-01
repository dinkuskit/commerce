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
];

const forbiddenSegments = new Set([
  ".env",
  ".npmrc",
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
    if (segments.some((segment) => segment.startsWith(".env."))) {
      findings.push(`forbidden environment path: ${path}`);
    }
    if (path.endsWith(".sql")) findings.push(`forbidden SQL path: ${path}`);
  }

  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.name !== "@dinkuskit/commerce") {
    findings.push("package name must be @dinkuskit/commerce");
  }
  if (manifest.version !== "0.0.0") findings.push("package version must start at 0.0.0");
  if (manifest.private !== true) findings.push("package must remain private at charter stage");
  if (manifest.license !== "MIT") findings.push("package license must be MIT");
  if (manifest.repository?.url !== "git+https://github.com/dinkuskit/commerce.git") {
    findings.push("package repository must be dinkuskit/commerce");
  }
  if (manifest.peerDependencies?.emdash !== "1.0.1") {
    findings.push("runtime peer must pin exact emdash 1.0.1");
  }
  const compatibility = manifest.dinkuskit?.emdashCompatibility;
  const requiredCompatibility = {
    apiPeer: "1.0.1",
    nodeEngine: ">=22.16",
    packageIntegrity: "sha512-tD2JluGSDfRS/NhTG4M+KEcQsTOFvEMbQlIaRpePk9bLizOES1QUKx20LAEAv0Mpfhz6knii87TDrJwNr+NvAA==",
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
  if (JSON.stringify(manifest.files) !== JSON.stringify(["dist", "emdash-plugin.jsonc"])) {
    findings.push("package files must contain only dist and emdash-plugin.jsonc");
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
