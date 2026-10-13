import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { auditChangesets, parseChangeset } from "../../.github/scripts/check-changeset.mjs";
import { findMajorViolation } from "../../.github/scripts/check-no-major.mjs";
import { syncPluginVersion } from "../../.github/scripts/release-version.mjs";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("changeset config follows the locked single-package shape", async () => {
	const config = JSON.parse(await read("../../.changeset/config.json"));
	assert.equal(config.baseBranch, "main");
	assert.equal(config.access, "public");
	assert.deepEqual(config.changelog, [
		"@changesets/changelog-github",
		{ repo: "dinkuskit/commerce" },
	]);
	assert.deepEqual(config.fixed, []);
	assert.deepEqual(config.ignore, []);
});

test("no-major guard holds the 1.0.0 gate", () => {
	assert.equal(findMajorViolation("0.2.0"), null);
	assert.equal(findMajorViolation("0.3.0-beta.1"), null);
	assert.match(findMajorViolation("1.0.0"), /1\.0\.0 gate/);
	assert.match(findMajorViolation("1.0.0-beta.1"), /1\.0\.0 gate/);
	assert.match(findMajorViolation("later"), /unparseable/);
});

test("changeset audit allows 0.x bumps and empty changesets only", () => {
	assert.deepEqual(parseChangeset("---\n---\n"), { bumps: {} });
	const audit = (source) => auditChangesets([{ path: ".changeset/x.md", source }]);
	assert.deepEqual(audit('---\n"@dinkuskit/commerce": patch\n---\n\nFix.\n'), []);
	assert.deepEqual(audit('---\n"@dinkuskit/commerce": minor\n---\n\nFeature.\n'), []);
	assert.match(audit('---\n"@dinkuskit/commerce": major\n---\n')[0], /not allowed on 0\.x/);
	assert.match(audit('---\n"@dinkuskit/other": patch\n---\n')[0], /unknown package/);
	assert.match(audit("no frontmatter")[0], /missing frontmatter/);
});

test("version sync rewrites only the plugin manifest version", () => {
	const source = '{\n  "slug": "dinkus-commerce",\n  "version": "0.2.0"\n}\n';
	assert.equal(
		syncPluginVersion(source, "0.3.0-beta.1"),
		'{\n  "slug": "dinkus-commerce",\n  "version": "0.3.0-beta.1"\n}\n',
	);
	assert.throws(() => syncPluginVersion("{}", "0.3.0"), /no "version" field/);
});

test("release workflow versions, tags, and delegates with pinned actions", async () => {
	const source = await read("../../.github/workflows/release.yml");
	for (const action of ["select-mode", "version", "publish"]) {
		assert.match(
			source,
			new RegExp(`changesets/action/${action}@[0-9a-f]{40}`),
			`changesets/action/${action} must be pinned`,
		);
	}
	assert.match(source, /actions\/create-github-app-token@[0-9a-f]{40}/);
	assert.match(source, /secrets\.RELEASE_APP_ID/);
	assert.match(source, /secrets\.RELEASE_APP_PRIVATE_KEY/);
	assert.match(source, /pr-title: "ci: release"/);
	assert.match(source, /script: npx changeset tag/);
	assert.match(source, /uses: \.\/\.github\/workflows\/emdash-release\.yml/);
	assert.match(source, /published-packages: \$\{\{ needs\.publish\.outputs\['published-packages'\] \}\}/);
	assert.match(source, /^permissions: \{\}$/m);
	assert.match(source, /cancel-in-progress: false/);
	assert.doesNotMatch(source, /npm publish/);
	assert.doesNotMatch(source, /echo[^\n]*secrets\./);
});

test("registry workflow is npm-based, pinned, and refuses prereleases", async () => {
	const source = await read("../../.github/workflows/emdash-release.yml");
	assert.match(source, /apps\/release-action@[0-9a-f]{40}/);
	assert.doesNotMatch(source, /release-action@main/);
	assert.doesNotMatch(source, /pnpm\/action-setup|pnpm (?:dlx|install)/);
	assert.match(source, /run: npm ci/);
	assert.match(source, /node-version-file: \.nvmrc/);
	assert.match(source, /Refuse prerelease versions/);
	assert.match(source, /id-token: write/);
	assert.match(source, /attestations: write/);
	// Release-gate invariant: Registry publishing is reachable only as a
	// reusable workflow delegated by release.yml after the ci: release
	// PR merges. A direct dispatch must never feed a hand-picked
	// package selector into the id-token-backed publish job.
	assert.doesNotMatch(source, /^ {2}workflow_dispatch:/m);
	assert.doesNotMatch(source, /inputs\.package/);
	assert.doesNotMatch(source, /release plan --package/);
	assert.match(source, /^ {2}workflow_call:/m);
});

test("changeset check workflow runs the audit script on pull requests", async () => {
	const source = await read("../../.github/workflows/changeset-check.yml");
	assert.match(source, /pull_request:/);
	assert.match(source, /check-changeset\.mjs/);
	assert.match(source, /^permissions:\n  contents: read$/m);
});
