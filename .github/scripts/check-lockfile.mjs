#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Package drift guard (repo-contract.yml package-drift job). package-lock.json must agree with
// package.json, every third-party entry must point at its own registry tarball, and after `npm ci`
// has checked each tarball against its integrity, the installed manifest must agree with the
// metadata the lock entry carries. A hand-edited lock entry or a package.json change without a
// lock refresh fails here instead of in a consumer install.
const REGISTRY = "https://registry.npmjs.org/";
const ROOT_FIELDS = [
	"name",
	"version",
	"license",
	"bin",
	"engines",
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
];
// Fields npm copies from the published manifest into each lock entry. funding, deprecated and
// hasInstallScript come from the registry document or are derived, so they are not compared.
const ENTRY_FIELDS = [
	"version",
	"license",
	"dependencies",
	"optionalDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"engines",
	"os",
	"cpu",
	"bin",
];

// npm writes objects with sorted keys and leaves out empty ones.
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		const keys = Object.keys(value).sort();
		if (keys.length === 0) return undefined;
		return Object.fromEntries(keys.map((key) => [key, canonical(value[key])]));
	}
	return value;
}

// npm writes bin as an object of paths without a leading "./"; a string bin is named after the
// package without its scope.
function normalizeBin(bin, name) {
	if (bin === undefined) return undefined;
	const entries = typeof bin === "string" ? [[name.split("/").pop(), bin]] : Object.entries(bin);
	return Object.fromEntries(entries.map(([key, path]) => [key, String(path).replace(/^\.\//, "")]));
}

function same(left, right) {
	return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function packageNameFor(path, entry) {
	return entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
}

export function expectedTarball(name, version) {
	return `${REGISTRY}${name}/-/${name.split("/").pop()}-${version}.tgz`;
}

export function auditRoot(pkg, lock) {
	const findings = [];
	const root = lock.packages?.[""];
	if (!root) return ['package-lock.json has no packages[""] entry'];
	if (lock.name !== pkg.name) findings.push(`package-lock.json name ${lock.name} != package.json ${pkg.name}`);
	if (lock.version !== pkg.version) {
		findings.push(`package-lock.json version ${lock.version} != package.json ${pkg.version}`);
	}
	for (const field of ROOT_FIELDS) {
		const expected = field === "bin" ? normalizeBin(pkg.bin, pkg.name) : pkg[field];
		if (!same(root[field], expected)) {
			findings.push(`packages[""].${field} does not match package.json ${field}; refresh package-lock.json with npm install`);
		}
	}
	return findings;
}

export function auditEntry(path, entry, installed) {
	const findings = [];
	if (entry.link) return findings;
	const name = packageNameFor(path, entry);
	const tarball = expectedTarball(name, entry.version);
	if (entry.resolved !== tarball) findings.push(`${path}: resolved ${entry.resolved} != ${tarball}`);
	if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity ?? "")) {
		findings.push(`${path}: integrity is not a sha512 digest`);
	}
	if (installed === undefined) return findings;
	if (installed.name !== name) findings.push(`${path}: installed name ${installed.name} != ${name}`);
	for (const field of ENTRY_FIELDS) {
		const expected = field === "bin" ? normalizeBin(installed.bin, name) : installed[field];
		if (!same(entry[field], expected)) {
			findings.push(`${path}: ${field} differs from the published ${name}@${installed.version} manifest`);
		}
	}
	return findings;
}

// Installed manifests are only read when node_modules exists; an entry npm skipped on this
// platform must be optional.
export function auditLockfile(pkg, lock, readInstalled) {
	const findings = auditRoot(pkg, lock);
	for (const [path, entry] of Object.entries(lock.packages ?? {})) {
		if (path === "" || !path.startsWith("node_modules/")) continue;
		const installed = readInstalled?.(path);
		if (readInstalled && installed === undefined && !entry.optional && !entry.link) {
			findings.push(`${path}: not installed by npm ci though not optional`);
		}
		findings.push(...auditEntry(path, entry, installed));
	}
	return findings;
}

// Engine floor: the lowest Node the package accepts. Only ">=X.Y.Z <N" ranges are understood, so
// a new range shape fails loudly instead of passing unchecked.
export function engineFloor(range) {
	const match = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range ?? "");
	if (!match) throw new Error(`unsupported engines.node range ${JSON.stringify(range)}`);
	const [, major, minor, patch, ceiling] = match.map(Number);
	return { floor: `${major}.${minor}.${patch}`, parts: [major, minor, patch], ceiling };
}

export function satisfiesEngine(version, range) {
	const { parts, ceiling } = engineFloor(range);
	const actual = String(version).trim().replace(/^v/, "").split(".").map(Number);
	if (actual.length !== 3 || actual.some(Number.isNaN)) return false;
	if (actual[0] >= ceiling) return false;
	for (let i = 0; i < 3; i += 1) {
		if (actual[i] !== parts[i]) return actual[i] > parts[i];
	}
	return true;
}

export function auditEngines(pkg, nvmrc, workflowFloors) {
	const findings = [];
	const range = pkg.engines?.node;
	let floor;
	try {
		({ floor } = engineFloor(range));
	} catch (error) {
		return [error.message];
	}
	const declared = pkg.dinkuskit?.emdashCompatibility?.nodeEngine;
	if (declared !== range) findings.push(`dinkuskit.emdashCompatibility.nodeEngine ${declared} != engines.node ${range}`);
	if (!satisfiesEngine(nvmrc, range)) findings.push(`.nvmrc ${String(nvmrc).trim()} is outside engines.node ${range}`);
	if (!workflowFloors.includes(floor)) {
		findings.push(`repo-contract.yml engine-floor matrix does not install at the engine floor ${floor}`);
	}
	return findings;
}

export function workflowEngineFloors(workflow) {
	const match = /^ {6}matrix:\n {8}node: \[([^\]]*)\]/m.exec(workflow);
	return match ? match[1].split(",").map((value) => value.trim().replace(/^["']|["']$/g, "")) : [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
	const readInstalled = existsSync("node_modules")
		? (path) => (existsSync(`${path}/package.json`) ? JSON.parse(readFileSync(`${path}/package.json`, "utf8")) : undefined)
		: undefined;
	const findings = [
		...auditLockfile(pkg, lock, readInstalled),
		...auditEngines(
			pkg,
			readFileSync(".nvmrc", "utf8"),
			workflowEngineFloors(readFileSync(".github/workflows/repo-contract.yml", "utf8")),
		),
	];
	if (findings.length > 0) {
		for (const finding of findings) console.error(`::error::${finding}`);
		process.exit(1);
	}
	const entries = Object.keys(lock.packages).length - 1;
	console.log(
		`Lockfile check passed (${entries} entries${readInstalled ? ", installed manifests compared" : ", no node_modules to compare"}).`,
	);
}
