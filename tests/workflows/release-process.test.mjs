import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { auditChangesets, parseChangeset } from "../../.github/scripts/check-changeset.mjs";
import { findMajorViolation } from "../../.github/scripts/check-no-major.mjs";
import { syncPluginVersion } from "../../.github/scripts/release-version.mjs";
import { betaManifest, effectiveSelector } from "../../scripts/beta-release.mjs";
import {
	computePackageChecksum,
	parseSelector,
	recordMatches,
	resolvePdsEndpoint,
} from "../../.github/scripts/verify-registry-release.mjs";

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

test("registry workflow is npm-based, pinned, and routes prereleases to beta", async () => {
	const source = await read("../../.github/workflows/emdash-release.yml");
	assert.match(source, /apps\/release-action@[0-9a-f]{40}/);
	assert.doesNotMatch(source, /release-action@main/);
	assert.doesNotMatch(source, /pnpm\/action-setup|pnpm (?:dlx|install)/);
	assert.match(source, /run: npm ci/);
	assert.match(source, /node-version-file: \.nvmrc/);
	assert.match(source, /Route release selector/);
	assert.match(source, /steps\.route\.outputs\.selector/);
	assert.doesNotMatch(source, /Refuse prerelease versions/);
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
	assert.ok(source.indexOf('run: npm run build') < source.indexOf('node scripts/prepare-emdash-release.mjs'));
	assert.match(source, /node scripts\/prepare-emdash-release\.mjs "\$\{EMDASH_RELEASE_SELECTOR\}"/);
	assert.doesNotMatch(source, /release prepare[^\n]*--dir \./);
});

test("beta routing sends only prereleases to the beta package", () => {
	assert.equal(effectiveSelector("dinkus-commerce@0.2.2"), "dinkus-commerce@0.2.2");
	assert.equal(
		effectiveSelector("dinkus-commerce@0.3.0-beta.1"),
		"dinkus-commerce-beta@0.3.0-beta.1",
	);
	assert.equal(
		effectiveSelector("dinkus-commerce-beta@0.3.0-beta.1"),
		"dinkus-commerce-beta@0.3.0-beta.1",
	);
	assert.equal(effectiveSelector("dinkus-commerce-beta@0.3.0"), null);
	assert.equal(effectiveSelector("no-version"), null);

	const stable = {
		slug: "dinkus-commerce",
		name: "Commerce",
		version: "0.3.0-beta.1",
		publisher: "did:plc:example",
		capabilities: ["media:read"],
	};
	const beta = betaManifest(stable);
	assert.equal(beta.slug, "dinkus-commerce-beta");
	assert.equal(beta.name, "Commerce Beta");
	assert.equal(beta.version, stable.version);
	assert.equal(beta.publisher, stable.publisher);
	assert.deepEqual(beta.capabilities, stable.capabilities);
	assert.throws(() => betaManifest(beta), /stable slug/);
});

test("changeset check workflow runs the audit script on pull requests", async () => {
	const source = await read("../../.github/workflows/changeset-check.yml");
	assert.match(source, /pull_request:/);
	assert.match(source, /check-changeset\.mjs/);
	assert.match(source, /^permissions:\n  contents: read$/m);
});

test("registry verifier computes the recorded package checksum", () => {
	assert.equal(
		computePackageChecksum(Buffer.from("")),
		"bciqohmgeikmpyhautl57jsezn64sij5oihsgjg4tjssjlgi3pbjlqvi",
	);
	assert.equal(
		computePackageChecksum(Buffer.from("abc")),
		"bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli",
	);
	assert.deepEqual(parseSelector("dinkus-commerce@0.2.1"), {
		slug: "dinkus-commerce",
		version: "0.2.1",
	});
	assert.equal(parseSelector("no-version"), null);
	assert.equal(parseSelector("@1.0.0"), null);
});

test("registry verifier accepts only the exact prepared bundle", () => {
	const expected = {
		slug: "dinkus-commerce",
		version: "0.2.1",
		checksum: "bciqexample",
		size: 44347,
	};
	const record = {
		package: "dinkus-commerce",
		version: "0.2.1",
		artifacts: {
			package: {
				checksum: "bciqexample",
				blob: { size: 44347, mimeType: "application/gzip" },
			},
		},
	};
	assert.deepEqual(recordMatches(record, expected), { ok: true, reasons: [] });
	assert.equal(recordMatches({ ...record, version: "0.2.2" }, expected).ok, false);
	assert.equal(
		recordMatches(
			{ ...record, artifacts: { package: { ...record.artifacts.package, checksum: "bciqother" } } },
			expected,
		).ok,
		false,
	);
	assert.equal(recordMatches(null, expected).ok, false);
	assert.equal(recordMatches({}, expected).ok, false);
});

test("publish outcome is gated on registry verification, not the intent", async () => {
	const source = await read("../../.github/workflows/emdash-release.yml");
	const continuations = [...source.matchAll(/continue-on-error: true/g)];
	assert.equal(continuations.length, 1, "only the publish step may continue on error");
	assert.match(source, /id: publish\n\s+continue-on-error: true/);
	assert.match(source, /verify-registry-release\.mjs/);
	assert.match(source, /id: verify/);
	// The intent-failure note claims the Registry record verified, so it
	// may only run when the verifier itself succeeded.
	assert.match(
		source,
		/steps\.publish\.outcome == 'failure' && steps\.verify\.outcome == 'success'/,
	);
	assert.ok(
		source.indexOf("verify-registry-release.mjs") > source.indexOf("id: publish"),
		"verification runs after the publish step",
	);
});


test("stable and beta Registry verification use the prepared selector", async () => {
  const workflow = await read("../../.github/workflows/emdash-release.yml");
  const stepSelector = (name) => {
    const step = workflow.split(`      - name: "${name}"`)[1]?.split("      - name:")[0];
    assert.ok(step, `missing ${name} step`);
    return step.match(/EMDASH_RELEASE_SELECTOR: "?\$\{\{ ([^}]+) \}\}"?/)?.[1];
  };
  const prepareSelector = stepSelector("Prepare plugin release");
  const verifySelector = stepSelector("Verify Registry release");
  for (const planned of ["dinkus-commerce@0.2.2", "dinkus-commerce@0.3.0-beta.1"]) {
    const routed = effectiveSelector(planned);
    const resolve = (expression) => expression === "steps.route.outputs.selector" ? routed : planned;
    const prepared = parseSelector(resolve(prepareSelector));
    const verified = parseSelector(resolve(verifySelector));
    assert.deepEqual(verified, prepared, `verify must use prepared identity for ${planned}`);
    const bytes = Buffer.from(`prepared artifact for ${routed}`);
    const expected = { ...verified, checksum: computePackageChecksum(bytes), size: bytes.length };
    const record = {
      package: prepared.slug,
      version: prepared.version,
      artifacts: { package: { checksum: computePackageChecksum(bytes), blob: { size: bytes.length, mimeType: "application/gzip" } } },
    };
    assert.equal(recordMatches(record, expected).ok, true);
    const wrongSlug = prepared.slug.endsWith("-beta") ? "dinkus-commerce" : "dinkus-commerce-beta";
    assert.equal(recordMatches({ ...record, package: wrongSlug }, expected).ok, false);
  }
  assert.equal(prepareSelector, "steps.route.outputs.selector");
  assert.equal(verifySelector, "steps.route.outputs.selector");
});

test("PDS resolution supports relative and publisher-qualified service IDs", async () => {
  for (const did of ["did:plc:publisher", "did:web:publisher.example"]) {
    for (const id of ["#atproto_pds", `${did}#atproto_pds`]) {
      const endpoint = await resolvePdsEndpoint(did, async () => new Response(JSON.stringify({
        id: did,
        service: [{ id, type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example" }],
      })));
      assert.equal(endpoint, "https://pds.example");
    }
    await assert.rejects(resolvePdsEndpoint(did, async () => new Response(JSON.stringify({
      id: did,
      service: [{ id: "did:plc:other#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://other.example" }],
    }))), /no #atproto_pds service/);
  }
});
