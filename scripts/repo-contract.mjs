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
  "LICENSE",
  "README.md",
  "REPO_HYGIENE.md",
  "SECURITY.md",
  "VISION.md",
  "package.json",
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

async function walk(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(root, absolute)));
    else paths.push(relative(root, absolute));
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
