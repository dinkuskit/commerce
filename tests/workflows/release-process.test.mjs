import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { auditChangesets, parseChangeset } from "../../.github/scripts/check-changeset.mjs";
import { findMajorViolation } from "../../.github/scripts/check-no-major.mjs";
import { syncPluginVersion } from "../../.github/scripts/release-version.mjs";
import { syncLockVersion } from "../../.github/scripts/sync-lock-version.mjs";
import { betaManifest, effectiveSelector } from "../../scripts/beta-release.mjs";
import {
	computePackageChecksum,
	parseSelector,
	listedRecordMatches,
	publishedArtifactMatches,
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

test("release workflow carries Cut beta, Add fix to beta and Promote, tags merged release PRs on their branch, and publishes from tags", async () => {
	const source = await read("../../.github/workflows/release.yml");
	// The release PR is opened only by Promote (release-branches-079), never by a bot on every merge.
	assert.doesNotMatch(source, /changesets\/action/);
	assert.match(source, /options:\n\s+- cut-beta\n\s+- add-fix\n\s+- promote\n/);
	assert.match(source, /^ {4}branches: \[main\]\n {4}tags: \["v\*\.\*\.\*"\]$/m);
	assert.match(source, /node scripts\/release-flow\.mjs cut-beta/);
	assert.match(source, /node scripts\/release-flow\.mjs add-fix/);
	assert.match(source, /node scripts\/release-flow\.mjs verify-release-tag/);
	assert.match(source, /actions\/create-github-app-token@[0-9a-f]{40}/);
	assert.match(source, /secrets\.RELEASE_APP_ID/);
	assert.match(source, /secrets\.RELEASE_APP_PRIVATE_KEY/);
	assert.match(source, /node scripts\/release-flow\.mjs promote/);
	assert.match(source, /node scripts\/release-flow\.mjs publish-merged-release/);
	assert.match(source, /uses: \.\/\.github\/workflows\/emdash-release\.yml/);
	assert.match(source, /release_mode: \$\{\{ needs\.release-tag\.outputs\.release_mode \}\}/);
	assert.match(source, /needs: \[release-tag, publish-emdash\]\n\s+if: needs\.release-tag\.outputs\.release_mode == 'beta'/);
	assert.match(source, /secrets\.DINKUS_LIVE_JOURNEYS_TOKEN/);
	assert.match(source, /gh workflow run live-journeys\.yml --repo dinkuskit\/live-journeys --ref main -f journeys=@running -f beta="\$BETA"/);
	assert.match(source, /^permissions: \{\}$/m);
	assert.match(source, /cancel-in-progress: false/);
	assert.doesNotMatch(source, /publish-only/);
	assert.doesNotMatch(source, /secrets: inherit/);
	assert.doesNotMatch(source, /npm publish/);
	assert.doesNotMatch(source, /echo[^\n]*secrets\./);
	// Install scripts and tests run before the release token exists.
	assert.ok(source.indexOf("run: npm ci") < source.indexOf("actions/create-github-app-token@"));
	assert.ok(source.indexOf("run: npm test") < source.indexOf("actions/create-github-app-token@"));
});

test("a stable release presses Docs from a plugin release in dinkuskit/dinkuskit with its tag", async () => {
	const source = await read("../../.github/workflows/release.yml");
	const job = source.slice(source.indexOf("\n  website-docs:\n"));
	assert.match(job, /needs: \[release-tag, publish-emdash\]\n\s+if: needs\.release-tag\.outputs\.release_mode == 'stable'\n/);
	assert.match(job, /permissions: \{\}/);
	assert.match(job, /repositories: dinkuskit\n\s+permission-actions: write\n/);
	assert.match(job, /TAG: v\$\{\{ needs\.publish-emdash\.outputs\.version \}\}/);
	assert.match(job, /gh workflow run docs-plugin-release\.yml --repo dinkuskit\/dinkuskit --ref main -f plugin=commerce -f tag="\$TAG"/);
	// The article it publishes is kept here, with the placeholders the release fills in.
	const article = await read("../../docs/website/reference/commerce.md");
	assert.match(article, /^version_scope: "Commerce \{\{version\}\}"$/m);
	assert.doesNotMatch(article, /^base:/m);
});

test("registry workflow is npm-based, pinned, call-only, and builds the version it publishes", async () => {
	const source = await read("../../.github/workflows/emdash-release.yml");
	assert.match(source, /apps\/release-action@[0-9a-f]{40}/);
	assert.doesNotMatch(source, /release-action@main/);
	assert.doesNotMatch(source, /pnpm\/action-setup|pnpm (?:dlx|install)/);
	assert.match(source, /run: npm ci/);
	assert.match(source, /node-version-file: \.nvmrc/);
	assert.match(source, /id-token: write/);
	assert.match(source, /attestations: write/);
	// Release-gate invariant: Registry publishing is reachable only as a reusable workflow that
	// release.yml's version-tag run calls, and the dispatch gate runs before any Registry I/O. It
	// has write scope only for release assets. A hand-picked package selector never reaches the publish job.
	assert.doesNotMatch(source, /^ {2}workflow_dispatch:/m);
	assert.match(source, /^ {2}workflow_call:/m);
	assert.doesNotMatch(source, /inputs\.package/);
	assert.doesNotMatch(source, /release plan/);
	const at = (needle) => {
		const index = source.indexOf(needle);
		assert.notEqual(index, -1, `missing ${needle}`);
		return index;
	};
	assert.doesNotMatch(source, /actions\/create-github-app-token@|RELEASE_APP_PRIVATE_KEY|release-flow\.mjs cut-beta/);
	assert.ok(at("node .github/scripts/emdash-dispatch-gate.mjs") < at("check-registry-version"));
	// A beta is stamped before the build preparation packs.
	assert.ok(at("stamp-beta-version") < at("run: npm run build"));
	assert.ok(at("run: npm run build") < at("node scripts/prepare-emdash-release.mjs"));
	assert.match(source, /node scripts\/prepare-emdash-release\.mjs "\$\{EMDASH_RELEASE_SELECTOR\}"/);
	assert.doesNotMatch(source, /release prepare[^\n]*--dir \./);
	assert.doesNotMatch(source, /contents: write/);
	assert.ok(at("actions/attest-build-provenance@") < at("node scripts/registry-release-media.mjs"));
	assert.ok(at("node scripts/registry-release-media.mjs") < at("emdash-cms/emdash/apps/release-action@"));
	const publish = source.split("      - name: Publish plugin to EmDash Registry\n")[1]?.split("      - name:")[0];
	// emdash-cms/emdash#4467's action uploads the listing images named beside the prepared manifest.
	assert.match(source, /apps\/release-action@45b542c016d35c7a88a590dce8e600e2384c13a9/);
	assert.match(publish, /bundle-file: \$\{\{ steps\.prepare\.outputs\.bundle-file \}\}/);
	assert.match(publish, /provenance-file: \$\{\{ steps\.attest\.outputs\.bundle-path \}\}/);
	assert.match(publish, /plugin-directory: \$\{\{ steps\.media\.outputs\.plugin-directory \}\}/);
	assert.doesNotMatch(publish, /release-file:/);
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

test("an already-listed version is verified by the record's provenance, not a rebuild", async () => {
	const builder = "https://github.com/dinkuskit/commerce/.github/workflows/release.yml@refs/tags/v0.6.0";
	const expected = { slug: "dinkus-commerce", version: "0.6.0", builder };
	const record = {
		package: "dinkus-commerce",
		version: "0.6.0",
		artifacts: { package: { checksum: "bciqpublished", blob: { size: 51783, mimeType: "application/gzip" } } },
		extensions: { "com.emdashcms.experimental.package.releaseExtension": { provenance: { builderId: builder } } },
	};
	assert.deepEqual(listedRecordMatches(record, expected), { ok: true, reasons: [] });
	const otherBuilder = { ...record, extensions: { "com.emdashcms.experimental.package.releaseExtension": { provenance: { builderId: builder.replace("refs/tags/v0.6.0", "refs/heads/main") } } } };
	assert.equal(listedRecordMatches(otherBuilder, expected).ok, false);
	assert.equal(listedRecordMatches({ ...record, extensions: undefined }, expected).ok, false);
	assert.equal(listedRecordMatches({ ...record, version: "0.6.1" }, expected).ok, false);
	assert.equal(listedRecordMatches(null, expected).ok, false);
	const source = await read("../../.github/workflows/emdash-release.yml");
	const verifyStep = source.split("      - name: Verify release is indexed in EmDash Registry\n")[1]?.split("      - name:")[0];
	assert.match(verifyStep, /ALREADY_PUBLISHED: \$\{\{ steps\.registry-check\.outputs\.already_published \}\}/);
	assert.match(verifyStep, /EXPECTED_BUILDER: https:\/\/github\.com\/\$\{\{ github\.workflow_ref \}\}/);
	assert.match(verifyStep, /--listed "\$EXPECTED_BUILDER"/);
	assert.match(verifyStep, /"\$BUNDLE_FILE"/);
	assert.match(verifyStep, /--listed "\$EXPECTED_BUILDER" "\$published"/);
	assert.match(verifyStep, /gh attestation verify "\$published" --repo "\$GITHUB_REPOSITORY"/);
	assert.match(verifyStep, /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/emdash-release\.yml"/);
	assert.match(verifyStep, /--source-ref "\$GITHUB_REF" --deny-self-hosted-runners/);
	const bytes = Buffer.from("published archive");
	const published = { artifacts: { package: { checksum: computePackageChecksum(bytes), blob: { size: bytes.length } } } };
	assert.deepEqual(publishedArtifactMatches(published, bytes), { ok: true, reasons: [] });
	assert.equal(publishedArtifactMatches(published, Buffer.from("altered archive!!")).ok, false);
	assert.equal(publishedArtifactMatches({}, bytes).ok, false);
	const publishStep = source.split("      - name: Publish plugin to EmDash Registry\n")[1]?.split("      - name:")[0];
	assert.match(publishStep, /wait-for-approval: "true"/);
});

test("publish outcome is gated on registry verification, not the intent", async () => {
	const source = await read("../../.github/workflows/emdash-release.yml");
	const continuations = [...source.matchAll(/continue-on-error: true/g)];
	assert.equal(continuations.length, 1, "only the publish step may continue on error");
	assert.match(source, /id: publish\n(?:\s+if: [^\n]+\n)?\s+continue-on-error: true/);
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
	// An already-listed version skips attest and publish but never the verifier.
	const verifyStep = source.split("      - name: Verify release is indexed in EmDash Registry\n")[1]?.split("      - name:")[0];
	assert.ok(verifyStep, "missing verify step");
	assert.doesNotMatch(verifyStep, /^\s+if:/m);
});

test("every version tag run reaches the Registry job, which verifies even an already-listed version", async () => {
	const release = await read("../../.github/workflows/release.yml");
	const job = release.split("\n  publish-emdash:\n")[1]?.split("\n  # A beta that")[0];
	assert.ok(job, "missing publish-emdash job");
	assert.match(job, /needs: release-tag\n/);
	assert.doesNotMatch(job, /^ {4}if:/m);
	const tagJob = release.split("\n  release-tag:\n")[1]?.split("\n  publish-emdash:\n")[0];
	assert.match(tagJob, /if: startsWith\(github\.ref, 'refs\/tags\/v'\) && \(github\.event_name == 'push' \|\| inputs\.action == 'retry-publish'\)/);
});


test("stable and beta Registry verification use the prepared selector", async () => {
  const workflow = await read("../../.github/workflows/emdash-release.yml");
  const stepSelector = (name) => {
    const step = workflow.split(`      - name: ${name}\n`)[1]?.split("      - name:")[0];
    assert.ok(step, `missing ${name} step`);
    return step.match(/EMDASH_RELEASE_SELECTOR: (.+)\n/)?.[1];
  };
  const prepareSelector = stepSelector("Prepare EmDash Registry release bundle");
  const verifySelector = stepSelector("Verify release is indexed in EmDash Registry");
  assert.equal(prepareSelector, "${{ steps.meta.outputs.slug }}@${{ steps.meta.outputs.version }}");
  assert.equal(verifySelector, prepareSelector);
  for (const [slug, version] of [["dinkus-commerce", "0.4.0"], ["dinkus-commerce-beta", "0.4.0-beta.1"]]) {
    const selector = prepareSelector
      .replace("${{ steps.meta.outputs.slug }}", slug)
      .replace("${{ steps.meta.outputs.version }}", version);
    assert.equal(effectiveSelector(selector), selector, `${selector} is already the routed identity`);
    const prepared = parseSelector(selector);
    const bytes = Buffer.from(`prepared artifact for ${selector}`);
    const expected = { ...prepared, checksum: computePackageChecksum(bytes), size: bytes.length };
    const record = {
      package: prepared.slug,
      version: prepared.version,
      artifacts: { package: { checksum: computePackageChecksum(bytes), blob: { size: bytes.length, mimeType: "application/gzip" } } },
    };
    assert.equal(recordMatches(record, expected).ok, true);
    const wrongSlug = prepared.slug.endsWith("-beta") ? "dinkus-commerce" : "dinkus-commerce-beta";
    assert.equal(recordMatches({ ...record, package: wrongSlug }, expected).ok, false);
  }
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

test("release:version changes only the lockfile's two version fields", async () => {
	const pkg = JSON.parse(await read("../../package.json"));
	assert.match(pkg.scripts["release:version"], /sync-lock-version\.mjs/);
	assert.doesNotMatch(pkg.scripts["release:version"], /npm install/);
	const before = await read("../../package-lock.json");
	const after = JSON.parse(syncLockVersion(before, "9.9.9"));
	const original = JSON.parse(before);
	assert.equal(after.version, "9.9.9");
	assert.equal(after.packages[""].version, "9.9.9");
	original.version = "9.9.9";
	original.packages[""].version = "9.9.9";
	assert.deepEqual(after, original);
	assert.equal(syncLockVersion(before, JSON.parse(before).version), before);
	assert.throws(() => syncLockVersion("{}", "1.0.0"), /no "version"/);
});
