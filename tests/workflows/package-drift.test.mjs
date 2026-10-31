import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	auditEngines,
	auditEntry,
	auditLockfile,
	auditRoot,
	engineFloor,
	expectedTarball,
	satisfiesEngine,
	workflowEngineFloors,
} from "../../.github/scripts/check-lockfile.mjs";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const PKG = {
	name: "@dinkuskit/commerce",
	version: "0.7.0",
	license: "MIT",
	engines: { node: ">=24.15.0 <25" },
	bin: { "dinkus-commerce": "./bin/dinkus-commerce.mjs" },
	devDependencies: { kysely: "0.29.5" },
	peerDependencies: { emdash: "1.4.0" },
	dinkuskit: { emdashCompatibility: { nodeEngine: ">=24.15.0 <25" } },
};

const ENTRY = {
	version: "0.29.5",
	resolved: expectedTarball("kysely", "0.29.5"),
	integrity: "sha512-AAAA",
	dev: true,
	license: "MIT",
	engines: { node: ">=20.0.0" },
};

function lockFor(pkg, overrides = {}) {
	return {
		name: pkg.name,
		version: pkg.version,
		lockfileVersion: 3,
		packages: {
			"": {
				name: pkg.name,
				version: pkg.version,
				license: pkg.license,
				bin: { "dinkus-commerce": "bin/dinkus-commerce.mjs" },
				devDependencies: pkg.devDependencies,
				engines: pkg.engines,
				peerDependencies: pkg.peerDependencies,
			},
			"node_modules/kysely": ENTRY,
			...overrides,
		},
	};
}

test("committed package-lock.json agrees with package.json, .nvmrc and the engine-floor matrix", async () => {
	const pkg = JSON.parse(await read("../../package.json"));
	const lock = JSON.parse(await read("../../package-lock.json"));
	assert.deepEqual(auditLockfile(pkg, lock), []);
	const workflow = await read("../../.github/workflows/repo-contract.yml");
	assert.deepEqual(auditEngines(pkg, await read("../../.nvmrc"), workflowEngineFloors(workflow)), []);
});

test("root entry drift between package.json and packages[\"\"] is refused", () => {
	assert.deepEqual(auditRoot(PKG, lockFor(PKG)), []);
	const bumped = { ...PKG, devDependencies: { kysely: "0.30.0" } };
	assert.match(auditRoot(bumped, lockFor(PKG)).join("\n"), /packages\[""\]\.devDependencies does not match/);
	const engines = { ...PKG, engines: { node: ">=24.16.0 <25" } };
	assert.match(auditRoot(engines, lockFor(PKG)).join("\n"), /packages\[""\]\.engines does not match/);
	const version = { ...PKG, version: "0.8.0" };
	assert.match(auditRoot(version, lockFor(PKG)).join("\n"), /package-lock\.json version 0\.7\.0 != package\.json 0\.8\.0/);
	assert.deepEqual(auditRoot(PKG, { packages: {} }), ['package-lock.json has no packages[""] entry']);
});

test("third-party entries must resolve to their own registry tarball with a sha512 digest", () => {
	assert.equal(expectedTarball("@scope/pkg", "1.2.3"), "https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz");
	assert.deepEqual(auditEntry("node_modules/kysely", ENTRY), []);
	const elsewhere = { ...ENTRY, resolved: "https://example.test/kysely-0.29.5.tgz" };
	assert.match(auditEntry("node_modules/kysely", elsewhere)[0], /resolved .* != https:\/\/registry\.npmjs\.org\/kysely/);
	assert.match(auditEntry("node_modules/kysely", { ...ENTRY, integrity: "sha1-AAAA" })[0], /not a sha512 digest/);
	const alias = { ...ENTRY, name: "typescript", version: "6.0.3", resolved: expectedTarball("typescript", "6.0.3") };
	assert.deepEqual(auditEntry("node_modules/typescript-api", alias), []);
});

test("lock entry metadata must match the installed published manifest", () => {
	const manifest = { name: "kysely", version: "0.29.5", license: "MIT", engines: { node: ">=20.0.0" }, bin: "./bin/k.js" };
	const entry = { ...ENTRY, bin: { kysely: "bin/k.js" } };
	assert.deepEqual(auditEntry("node_modules/kysely", entry, manifest), []);
	assert.deepEqual(auditEntry("node_modules/kysely", entry, { ...manifest, dependencies: {} }), []);
	const edited = { ...entry, engines: { node: ">=18.0.0" } };
	assert.match(auditEntry("node_modules/kysely", edited, manifest)[0], /engines differs from the published kysely@0\.29\.5 manifest/);
	const deps = { ...entry, dependencies: { tslib: "^2.0.0" } };
	assert.match(auditEntry("node_modules/kysely", deps, manifest)[0], /dependencies differs/);
	assert.match(auditEntry("node_modules/kysely", entry, { ...manifest, version: "0.29.6" })[0], /version differs/);
});

test("only optional entries may be missing from node_modules", () => {
	const lock = lockFor(PKG, { "node_modules/fsevents": { ...ENTRY, version: "2.3.3", resolved: expectedTarball("fsevents", "2.3.3"), optional: true } });
	assert.deepEqual(auditLockfile(PKG, lock, () => undefined).filter((f) => f.includes("fsevents")), []);
	assert.match(auditLockfile(PKG, lock, () => undefined).join("\n"), /node_modules\/kysely: not installed by npm ci though not optional/);
});

test("engine floor, .nvmrc and the compatibility record follow engines.node", () => {
	assert.deepEqual(engineFloor(">=24.15.0 <25"), { floor: "24.15.0", parts: [24, 15, 0], ceiling: 25 });
	assert.throws(() => engineFloor("^24"), /unsupported engines\.node range/);
	assert.equal(satisfiesEngine("24.22.0\n", ">=24.15.0 <25"), true);
	assert.equal(satisfiesEngine("v24.15.0", ">=24.15.0 <25"), true);
	assert.equal(satisfiesEngine("24.14.9", ">=24.15.0 <25"), false);
	assert.equal(satisfiesEngine("25.0.0", ">=24.15.0 <25"), false);
	assert.equal(satisfiesEngine("24", ">=24.15.0 <25"), false);
	assert.deepEqual(auditEngines(PKG, "24.22.0", ["24.15.0"]), []);
	assert.match(auditEngines(PKG, "24.22.0", ["24.14.0"])[0], /engine-floor matrix does not install at the engine floor 24\.15\.0/);
	assert.match(auditEngines(PKG, "22.0.0", ["24.15.0"])[0], /\.nvmrc 22\.0\.0 is outside engines\.node/);
	const stale = { ...PKG, dinkuskit: { emdashCompatibility: { nodeEngine: ">=22 <25" } } };
	assert.match(auditEngines(stale, "24.22.0", ["24.15.0"])[0], /nodeEngine >=22 <25 != engines\.node/);
});

test("pull requests run the whitespace, changeset and lockfile checks inside public-contract", async () => {
	const workflow = await read("../../.github/workflows/repo-contract.yml");
	const job = workflow.match(/\n  package-drift:\n([\s\S]*?)\n\n(?:  #[^\n]*\n)*  engine-floor:/)?.[1];
	assert.ok(job, "expected a package-drift job before engine-floor in repo-contract.yml");
	assert.match(job, /git diff --check "\$BASE_SHA\.\.\.\$HEAD_SHA" -- \. ':\(exclude\)CHANGELOG\.md'/);
	assert.match(job, /node \.github\/scripts\/check-changeset\.mjs "\$BASE_SHA" "\$HEAD_SHA" "\$HEAD_REF"/);
	assert.match(job, /run: npm ci --engine-strict\n {6}- run: node \.github\/scripts\/check-lockfile\.mjs/);
	assert.match(workflow, /engine-floor:[\s\S]*node-version: \$\{\{ matrix\.node \}\}[\s\S]*run: npm ci --engine-strict/);
	assert.deepEqual(workflowEngineFloors(workflow), ["24.15.0"]);
	assert.match(workflow, /test "\$PACKAGE_DRIFT" = success\n {10}test "\$ENGINE_FLOOR" = success/);
});
