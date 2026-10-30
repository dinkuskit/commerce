import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  computePackageChecksum,
  parseSelector,
  recordMatches,
  resolvePdsEndpoint,
} from "../../.github/scripts/verify-registry-release.mjs";
import {
  runExtractedGateScriptProcess,
  runReleaseAuthorityProof,
  verifyShippedEmDashWorkflowGateBinding,
} from "../../scripts/release-authority-proof.mjs";
import {
  BASELINE_TAG,
  BASELINE_VERSION,
  BETA_INSTALLED_PLUGIN_ID,
  BETA_REGISTRY_SLUG,
  PACKAGE_NAME,
  RELEASE_PR_BRANCH,
  RELEASE_PR_TITLE_PREFIX,
  STABLE_INSTALLED_PLUGIN_ID,
  STABLE_REGISTRY_SLUG,
  bumpPatch,
  compareSemver,
  computeNextBetaVersion,
  computeTargetVersion,
  extractChangelogSection,
  fetchRegistryVersions,
  findMissingChangesets,
  formatBetaProofRecord,
  highestBumpType,
  insertChangelogSection,
  isAllowedReleaseTreePath,
  parseBetaProofRecord,
  parseChangesetFrontmatter,
  readPendingChangesets,
  repositoryRoot,
  runReleaseFlowCli,
  validateBetaPromotionGate,
  validateEmDashDispatchGate,
  verifyApprovedBetaSourceTree,
  verifyVersionOnlyPackageMetadata,
  verifyVersionOnlyPluginManifest,
} from "../../scripts/release-flow.mjs";

test("locked stable and beta EmDash Registry identities match release-branches-079", () => {
  assert.equal(STABLE_REGISTRY_SLUG, "dinkus-commerce");
  assert.equal(BETA_REGISTRY_SLUG, "dinkus-commerce-beta");
  assert.equal(STABLE_INSTALLED_PLUGIN_ID, "r_gshdrqaldna3r7sn");
  assert.equal(BETA_INSTALLED_PLUGIN_ID, "r_fjzjvld3ssb4j63o");
  assert.equal(BASELINE_VERSION, "0.3.0");
  assert.equal(BASELINE_TAG, "v0.3.0");
  assert.notEqual(STABLE_INSTALLED_PLUGIN_ID, BETA_INSTALLED_PLUGIN_ID);
});

test("parseChangesetFrontmatter parses valid changesets and rejects invalid ones", () => {
  const parsed = parseChangesetFrontmatter(
    `---\n"@dinkuskit/commerce": patch\n---\n\nAdd release-beta-cut-071 automation.\n`,
    ".changeset/release-flow.md",
  );
  assert.equal(parsed.bump, "patch");
  assert.equal(parsed.summary, "Add release-beta-cut-071 automation.");

  assert.throws(
    () => parseChangesetFrontmatter(`No frontmatter here`, ".changeset/bad.md"),
    /missing YAML frontmatter/,
  );
  assert.throws(
    () =>
      parseChangesetFrontmatter(
        `---\n"@dinkuskit/payments": minor\n---\n\nWrong package.\n`,
        ".changeset/wrong.md",
      ),
    /must target "@dinkuskit\/commerce"/,
  );
  assert.throws(
    () =>
      parseChangesetFrontmatter(
        `---\n"@dinkuskit/commerce": patch\n---\n\n   \n`,
        ".changeset/empty.md",
      ),
    /non-empty summary body/,
  );
});

test("findMissingChangesets requires at least one .changeset/*.md file on normal PRs and exempts ci: release PRs", () => {
  const missing = findMissingChangesets({
    changedFiles: ["src/plugin.ts", "README.md", ".changeset/README.md"],
    headRef: "feat/new-webhook",
    title: "feat: handle webhook retry",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.exempted, false);
  assert.match(missing.message, /Every PR must include at least one changeset/);

  const present = findMissingChangesets({
    changedFiles: ["src/plugin.ts", ".changeset/webhook-retry.md"],
    headRef: "feat/new-webhook",
    title: "feat: handle webhook retry",
  });
  assert.equal(present.ok, true);
  assert.equal(present.exempted, false);
  assert.deepEqual(present.changesetFiles, [".changeset/webhook-retry.md"]);

  const releaseBranchExempt = findMissingChangesets({
    changedFiles: ["package.json", "CHANGELOG.md"],
    headRef: RELEASE_PR_BRANCH,
    title: `${RELEASE_PR_TITLE_PREFIX} v0.3.1`,
  });
  assert.equal(releaseBranchExempt.ok, true);
  assert.equal(releaseBranchExempt.exempted, true);
});

test("parseChangesetFrontmatter and readPendingChangesets support explicit empty changesets (`changeset --empty`) and exclude them from bumps", async () => {
  const emptyParsed = parseChangesetFrontmatter("---\n---\n", ".changeset/empty.md");
  assert.equal(emptyParsed.empty, true);
  assert.equal(emptyParsed.bump, null);

  const emptyWithNote = parseChangesetFrontmatter(
    "---\n---\n\nInternal CI workflow update with no version bump.\n",
    ".changeset/empty-note.md",
  );
  assert.equal(emptyWithNote.empty, true);
  assert.equal(emptyWithNote.bump, null);

  assert.equal(highestBumpType([null, undefined]), null);
  assert.equal(computeTargetVersion("0.3.0", [null]), null);
  assert.equal(computeTargetVersion("0.3.0", [null, "patch"]), "0.3.1");

  const tempRoot = await mkdtemp(join(tmpdir(), "commerce-empty-changeset-"));
  try {
    await mkdir(join(tempRoot, ".changeset"), { recursive: true });
    await writeFile(join(tempRoot, ".changeset/README.md"), "# Changesets\n", "utf8");
    await writeFile(join(tempRoot, ".changeset/01-empty.md"), "---\n---\n", "utf8");
    await writeFile(
      join(tempRoot, ".changeset/02-patch.md"),
      `---\n"${PACKAGE_NAME}": patch\n---\n\nFix status badge copy.\n`,
      "utf8",
    );

    const bumpingOnly = await readPendingChangesets(tempRoot);
    assert.equal(bumpingOnly.length, 1);
    assert.equal(bumpingOnly[0].filePath, ".changeset/02-patch.md");
    assert.equal(bumpingOnly[0].bump, "patch");

    const allChangesets = await readPendingChangesets(tempRoot, { includeEmpty: true });
    assert.equal(allChangesets.length, 2);
    assert.equal(allChangesets[0].empty, true);
    assert.equal(allChangesets[1].empty, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("computeTargetVersion and computeNextBetaVersion advance monotonically from git tags and dinkus-commerce-beta registry versions", () => {
  const patchEntry = parseChangesetFrontmatter(
    `---\n"${PACKAGE_NAME}": patch\n---\n\nFix status screen copy.\n`,
    ".changeset/fix-copy.md",
  );
  const minorEntry = parseChangesetFrontmatter(
    `---\n"${PACKAGE_NAME}": minor\n---\n\nAdd refund summary panel.\n`,
    ".changeset/refund-panel.md",
  );

  assert.equal(computeTargetVersion("0.3.0", [patchEntry.bump]), "0.3.1");
  assert.equal(computeTargetVersion("0.3.0", [patchEntry.bump, minorEntry.bump]), "0.4.0");

  const firstBeta = computeNextBetaVersion({
    targetVersion: "0.3.1",
    gitTags: ["v0.3.0"],
    registryVersions: [],
  });
  assert.equal(firstBeta.version, "0.3.1-beta.1");
  assert.equal(firstBeta.tag, "v0.3.1-beta.1");
  assert.equal(firstBeta.slug, BETA_REGISTRY_SLUG);

  const secondBeta = computeNextBetaVersion({
    targetVersion: "0.3.1",
    gitTags: ["v0.3.0", "v0.3.1-beta.1"],
    registryVersions: ["0.3.1-beta.2"],
  });
  assert.equal(secondBeta.version, "0.3.1-beta.3");
  assert.equal(secondBeta.tag, "v0.3.1-beta.3");
});

test("validateEmDashDispatchGate and .github/scripts/emdash-dispatch-gate.mjs agree on every caller/dispatch case and bind to emdash-release.yml", async () => {
  const binding = await verifyShippedEmDashWorkflowGateBinding();
  assert.equal(binding.jobIfMatches, true);
  assert.equal(binding.gateScriptInvokedBeforeCredentials, true);
  assert.equal(binding.callerPassesStableReleaseMode, true);
  assert.equal(binding.callerPassesBetaReleaseMode, true);
  assert.equal(binding.delegatedOidcReleaseConfigured, true);

  const testCases = [
    {
      label: "beta tag run with release_mode=beta publishes the beta package",
      input: { eventName: "push", ref: "refs/tags/v0.3.1-beta.2", inputVersion: "0.3.1-beta.2", releaseMode: "beta" },
      expectedOk: true,
      expectedMode: "beta-tag",
      expectedSlug: BETA_REGISTRY_SLUG,
    },
    {
      label: "stable tag run with release_mode=stable publishes the stable package",
      input: { eventName: "push", ref: "refs/tags/v0.3.1", inputVersion: "0.3.1", releaseMode: "stable" },
      expectedOk: true,
      expectedMode: "stable-tag",
      expectedSlug: STABLE_REGISTRY_SLUG,
    },
    {
      label: "a Run workflow press never publishes, even naming a beta",
      input: { eventName: "workflow_dispatch", ref: "refs/heads/main", inputVersion: "0.3.1-beta.2", releaseMode: "beta" },
      expectedOk: false,
      expectedCode: "dispatch_publish_forbidden",
    },
    {
      label: "a Run workflow press on main spoofing release_mode=stable is rejected",
      input: { eventName: "workflow_dispatch", ref: "refs/heads/main", inputVersion: "0.3.1", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "dispatch_publish_forbidden",
    },
    {
      label: "Retry the publish pressed on a stable tag runs that tag's publish",
      input: { eventName: "workflow_dispatch", ref: "refs/tags/v0.3.1", inputVersion: "0.3.1", releaseMode: "stable" },
      expectedOk: true,
      expectedMode: "stable-tag",
      expectedSlug: STABLE_REGISTRY_SLUG,
    },
    {
      label: "Retry the publish on a beta tag cannot switch to release_mode=stable",
      input: { eventName: "workflow_dispatch", ref: "refs/tags/v0.3.1-beta.1", inputVersion: "0.3.1-beta.1", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "missing_beta_caller_input",
    },
    {
      label: "push to main never publishes",
      input: { eventName: "push", ref: "refs/heads/main", inputVersion: "0.3.1", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "forbidden_caller_ref",
    },
    {
      label: "push to a release branch never publishes",
      input: { eventName: "push", ref: "refs/heads/release/0.3.1", inputVersion: "0.3.1-beta.1", releaseMode: "beta" },
      expectedOk: false,
      expectedCode: "forbidden_caller_ref",
    },
    {
      label: "a tag that is not a version is rejected",
      input: { eventName: "push", ref: "refs/tags/release-0.3.1", inputVersion: "0.3.1", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "forbidden_caller_ref",
    },
    {
      label: "version input must equal the tag's version",
      input: { eventName: "push", ref: "refs/tags/v0.3.1", inputVersion: "0.3.2", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "version_tag_mismatch",
    },
    {
      label: "missing version input is rejected",
      input: { eventName: "push", ref: "refs/tags/v0.3.1", inputVersion: "", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "version_tag_mismatch",
    },
    {
      label: "beta tag with release_mode=stable is rejected",
      input: { eventName: "push", ref: "refs/tags/v0.3.1-beta.1", inputVersion: "0.3.1-beta.1", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "missing_beta_caller_input",
    },
    {
      label: "stable tag with release_mode=beta is rejected",
      input: { eventName: "push", ref: "refs/tags/v0.3.1", inputVersion: "0.3.1", releaseMode: "beta" },
      expectedOk: false,
      expectedCode: "missing_stable_caller_input",
    },
    {
      label: "unsupported event rejected",
      input: { eventName: "pull_request", ref: "refs/tags/v0.3.1", inputVersion: "0.3.1", releaseMode: "stable" },
      expectedOk: false,
      expectedCode: "unsupported_event",
    },
  ];

  for (const tc of testCases) {
    const jsGate = validateEmDashDispatchGate(tc.input);
    const cliProc = runExtractedGateScriptProcess(tc.input);

    assert.equal(jsGate.ok, tc.expectedOk, `${tc.label}: JS gate ok mismatch`);
    assert.equal(cliProc.exitCode === 0, tc.expectedOk, `${tc.label}: CLI script exitCode mismatch`);

    if (tc.expectedOk) {
      assert.equal(jsGate.mode, tc.expectedMode, `${tc.label}: mode mismatch`);
      assert.equal(jsGate.slug, tc.expectedSlug, `${tc.label}: slug mismatch`);
      assert.deepEqual(cliProc.parsed, jsGate, `${tc.label}: CLI JSON output must match JS gate`);
    } else {
      assert.equal(jsGate.code, tc.expectedCode, `${tc.label}: error code mismatch`);
      assert.match(cliProc.stderr, new RegExp(jsGate.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

const TEST_PUBLISHER = "did:plc:ekk4pjmkh3k3ql2kfoex3qt4";
const TEST_PDS = "https://publisher.example";
const RELEASE_COLLECTION = "com.emdashcms.experimental.package.release";
const releaseRecord = (version, slug = BETA_REGISTRY_SLUG) => ({
  uri: `at://${TEST_PUBLISHER}/${RELEASE_COLLECTION}/${slug}:${version}`,
  value: { package: slug, version },
});
const mockPdsFetch = (response) => async (url) => {
  if (String(url).startsWith("https://plc.directory/")) {
    return { ok: true, json: async () => ({ service: [{ id: "#atproto_pds", serviceEndpoint: TEST_PDS }] }) };
  }
  return typeof response === "function" ? response(new URL(url)) : response;
};
const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });

async function writePublisherManifest(root, version = "0.3.0") {
  await writeFile(
    join(root, "emdash-plugin.jsonc"),
    `${JSON.stringify({ slug: STABLE_REGISTRY_SLUG, version, publisher: TEST_PUBLISHER }, null, 2)}\n`,
  );
}

test("release inventory follows the manifest publisher and all PDS pages, including unlisted versions", async () => {
  const calls = [];
  const versions = await fetchRegistryVersions(BETA_REGISTRY_SLUG, {
    root: repositoryRoot,
    fetchImpl: mockPdsFetch((url) => {
      calls.push(url);
      assert.equal(url.origin, TEST_PDS);
      assert.equal(url.pathname, "/xrpc/com.atproto.repo.listRecords");
      assert.equal(url.searchParams.get("repo"), TEST_PUBLISHER);
      assert.equal(url.searchParams.get("collection"), RELEASE_COLLECTION);
      assert.equal(url.searchParams.get("limit"), "100");
      return jsonResponse(url.searchParams.has("cursor")
        ? { records: [releaseRecord("0.3.1-beta.8")] }
        : { records: [releaseRecord("0.3.1-beta.2"), releaseRecord("0.3.0", STABLE_REGISTRY_SLUG)], cursor: "page2" });
    }),
  });
  assert.deepEqual(versions, ["0.3.1-beta.2", "0.3.1-beta.8"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("cursor"), "page2");
  assert.deepEqual(await fetchRegistryVersions(BETA_REGISTRY_SLUG, {
    root: repositoryRoot, fetchImpl: mockPdsFetch(jsonResponse({ records: [] })),
  }), []);
});

test("changeset parsing remains available before dependencies are installed", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-no-dependencies-"));
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(root, ".github/scripts"), { recursive: true });
    await writeFile(join(root, "scripts/release-flow.mjs"), await readFile(join(repositoryRoot, "scripts/release-flow.mjs")));
    await writeFile(join(root, ".github/scripts/verify-registry-release.mjs"), await readFile(join(repositoryRoot, ".github/scripts/verify-registry-release.mjs")));
    await writeFile(join(root, ".github/scripts/release-version.mjs"), await readFile(join(repositoryRoot, ".github/scripts/release-version.mjs")));
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { parseChangesetFrontmatter } from ${JSON.stringify(`file://${join(root, "scripts/release-flow.mjs")}`)};
      if (!parseChangesetFrontmatter('---\\n---\\n').empty) process.exit(1);
    `]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release inventory reads the plain-JSON publisher identity and rejects malformed manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-json-publisher-"));
  try {
    const manifestPath = join(root, "emdash-plugin.jsonc");
    const fetchImpl = mockPdsFetch(jsonResponse({ records: [] }));
    await writeFile(manifestPath, `{\n  "publisher": "${TEST_PUBLISHER}"\n}\n`);
    assert.deepEqual(await fetchRegistryVersions(BETA_REGISTRY_SLUG, { root, fetchImpl }), []);
    await writeFile(manifestPath, `{"publisher": "${TEST_PUBLISHER}", broken}`);
    await assert.rejects(() => fetchRegistryVersions(BETA_REGISTRY_SLUG, { root, fetchImpl }), /Invalid JSON in emdash-plugin\.jsonc/);
    await writeFile(manifestPath, "[]");
    await assert.rejects(() => fetchRegistryVersions(BETA_REGISTRY_SLUG, { root, fetchImpl }), /must be a JSON object/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release inventory failures abort beta tagging and release checks", async () => {
  const malformedCases = [
    { name: "network failure", response: () => { throw new Error("fetch failed"); }, pattern: /fetch failed/ },
    { name: "HTTP 503", response: { ok: false, status: 503 }, pattern: /HTTP 503/ },
    { name: "404 is not empty history", response: { ok: false, status: 404 }, pattern: /HTTP 404/ },
    { name: "invalid JSON", response: { ok: true, json: async () => { throw new Error("invalid JSON"); } }, pattern: /invalid JSON/ },
    { name: "missing records", response: jsonResponse({}), pattern: /records.*array/ },
    { name: "old aggregator shape", response: jsonResponse({ versions: [] }), pattern: /records.*array/ },
    { name: "invalid record", response: jsonResponse({ records: [{}] }), pattern: /record/ },
    { name: "foreign publisher", response: jsonResponse({ records: [{ ...releaseRecord("0.3.1-beta.1"), uri: `at://did:plc:wrong/${RELEASE_COLLECTION}/${BETA_REGISTRY_SLUG}:0.3.1-beta.1` }] }), pattern: /URI/ },
    { name: "URI version mismatch", response: jsonResponse({ records: [{ ...releaseRecord("0.3.1-beta.1"), value: { package: BETA_REGISTRY_SLUG, version: "0.3.1-beta.2" } }] }), pattern: /URI/ },
    { name: "invalid version", response: jsonResponse({ records: [releaseRecord("invalid")] }), pattern: /semantic version/ },
    { name: "invalid cursor", response: jsonResponse({ records: [], cursor: 42 }), pattern: /cursor/ },
    { name: "looping cursor", response: jsonResponse({ records: [], cursor: "same" }), pattern: /cursor/ },
  ];
  const tempRoot = await mkdtemp(join(tmpdir(), "commerce-registry-validation-"));
  try {
    await writePublisherManifest(tempRoot);
    await mkdir(join(tempRoot, ".changeset"), { recursive: true });
    await writeFile(join(tempRoot, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version: "0.3.0" }));
    await writeFile(join(tempRoot, ".changeset/bump.md"), `---\n"${PACKAGE_NAME}": patch\n---\n\nFix.\n`);
    const gitCalls = [];
    const deps = { root: tempRoot, gitExec: (args) => { gitCalls.push(args); return ""; }, log: () => {} };
    for (const tc of malformedCases) {
      const fetchImpl = mockPdsFetch(tc.response);
      await assert.rejects(() => fetchRegistryVersions(BETA_REGISTRY_SLUG, { root: tempRoot, fetchImpl }), tc.pattern, tc.name);
      await assert.rejects(() => runReleaseFlowCli(["cut-beta"], { ...deps, fetchImpl }), tc.pattern, tc.name);
      await assert.rejects(() => runReleaseFlowCli(["check-registry-version", "--slug", BETA_REGISTRY_SLUG, "--version", "0.3.1-beta.1"], { ...deps, fetchImpl }), tc.pattern, tc.name);
    }
    assert.equal(gitCalls.some(([command]) => command === "push"), false);
    assert.equal(gitCalls.some(([command, option]) => command === "tag" && option !== "--list"), false);

    const result = await runReleaseFlowCli(["plan-beta"], {
      ...deps, fetchImpl: mockPdsFetch(jsonResponse({ records: [releaseRecord("0.3.1-beta.8")] })),
    });
    assert.equal(result.version, "0.3.1-beta.9");
    assert.equal(result.betaTag, "v0.3.1-beta.9");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validateBetaPromotionGate enforces the beta at its release branch tip, not yet released, in the Registry, with @running proof", () => {
  const betaSha = "1234567890abcdef1234567890abcdef12345678";
  const proofRef = "https://github.com/dinkuskit/live-journeys/actions/runs/100 (0.3.1-beta.1 @running pass)";
  const base = {
    targetVersion: "0.3.1",
    betaVersion: "0.3.1-beta.1",
    betaTagSha: betaSha,
    branchTipSha: betaSha,
    registryHasBetaVersion: true,
    proofRef,
  };

  const moved = validateBetaPromotionGate({ ...base, branchTipSha: "fedcba0987654321fedcba0987654321fedcba09" });
  assert.equal(moved.ok, false);
  assert.equal(moved.code, "release_branch_advanced_since_beta");

  assert.equal(validateBetaPromotionGate({ ...base, branchTipSha: "" }).code, "missing_release_branch");
  assert.equal(validateBetaPromotionGate({ ...base, betaTagSha: "" }).code, "missing_beta_tag");
  assert.equal(validateBetaPromotionGate({ ...base, stableTagSha: betaSha }).code, "already_released");
  assert.equal(validateBetaPromotionGate({ ...base, registryHasBetaVersion: false }).code, "beta_not_in_registry");
  assert.equal(validateBetaPromotionGate({ ...base, betaVersion: "0.3.2-beta.1" }).code, "beta_version_mismatch");

  const missingProof = validateBetaPromotionGate({ ...base, proofRef: "" });
  assert.equal(missingProof.ok, false);
  assert.equal(missingProof.code, "missing_beta_proof");

  const valid = validateBetaPromotionGate(base);
  assert.equal(valid.ok, true);
  assert.equal(valid.releaseBranch, "release/0.3.1");
  assert.deepEqual(parseBetaProofRecord(valid.trailer), { betaVersion: "0.3.1-beta.1", betaSha, proofRef });
});

test("insertChangelogSection puts a version above the newest section once", () => {
  const changelog = "# @dinkuskit/commerce\n\n## 0.3.0\n\n- Baseline.\n";
  const once = insertChangelogSection(changelog, "0.3.1", "### Patch Changes\n\n- Fix.");
  assert.equal(once, "# @dinkuskit/commerce\n\n## 0.3.1\n\n### Patch Changes\n\n- Fix.\n\n## 0.3.0\n\n- Baseline.\n");
  assert.equal(insertChangelogSection(once, "0.3.1", "- Other."), once);
  assert.equal(compareSemver("0.3.2", "0.3.10"), -1);
  assert.equal(compareSemver("0.4.0", "0.4.0-beta.3"), 1);
  assert.equal(bumpPatch("0.4.0"), "0.4.1");
});

test("verifyApprovedBetaSourceTree and verifyVersionOnlyPackageMetadata enforce version-only package.json and package-lock.json diffs", () => {
  const betaSha = "abcdef1234567890abcdef1234567890abcdef12";
  const proof = {
    betaVersion: "0.3.1-beta.1",
    betaSha,
    proofRef: "run-999 0.3.1-beta.1 @running pass",
  };

  const basePkg = {
    name: PACKAGE_NAME,
    version: "0.3.0",
    type: "module",
    scripts: { build: "npm run plugin:build" },
    dependencies: { jose: "6.2.12", stripe: "23.0.0" },
  };
  const baseLock = {
    name: PACKAGE_NAME,
    version: "0.3.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: PACKAGE_NAME,
        version: "0.3.0",
        dependencies: { jose: "6.2.12", stripe: "23.0.0" },
      },
      "node_modules/stripe": {
        version: "23.0.0",
        resolved: "https://registry.npmjs.org/stripe/-/stripe-23.0.0.tgz",
        integrity: "sha512-valid==",
      },
    },
  };

  const cleanReleasePkg = { ...basePkg, version: "0.3.1" };
  const cleanReleaseLock = structuredClone(baseLock);
  cleanReleaseLock.version = "0.3.1";
  cleanReleaseLock.packages[""].version = "0.3.1";

  // 1. Version-only bump passes
  const cleanTree = verifyApprovedBetaSourceTree({
    version: "0.3.1",
    proof,
    betaTagSha: betaSha,
    changedPathsSinceBeta: ["package.json", "package-lock.json", "CHANGELOG.md", ".changeset/fix-checkout.md"],
    betaPackageJsonText: JSON.stringify(basePkg),
    releasePackageJsonText: JSON.stringify(cleanReleasePkg),
    betaPackageLockText: JSON.stringify(baseLock),
    releasePackageLockText: JSON.stringify(cleanReleaseLock),
  });
  assert.equal(cleanTree.ok, true);

  // 2. Dependency change in package.json is rejected
  const depChangedPkg = {
    ...cleanReleasePkg,
    dependencies: { ...cleanReleasePkg.dependencies, "malicious-dep": "1.0.0" },
  };
  const depResult = verifyApprovedBetaSourceTree({
    version: "0.3.1",
    proof,
    betaTagSha: betaSha,
    changedPathsSinceBeta: ["package.json", "package-lock.json", "CHANGELOG.md"],
    betaPackageJsonText: JSON.stringify(basePkg),
    releasePackageJsonText: JSON.stringify(depChangedPkg),
    betaPackageLockText: JSON.stringify(baseLock),
    releasePackageLockText: JSON.stringify(cleanReleaseLock),
  });
  assert.equal(depResult.ok, false);
  assert.equal(depResult.code, "unapproved_package_metadata_change");
  assert.match(depResult.message, /package\.json modified non-version fields.*dependencies/);

  // 3. Script change in package.json is rejected
  const scriptChangedPkg = {
    ...cleanReleasePkg,
    scripts: { build: "node -e 'evil()'" },
  };
  const scriptResult = verifyApprovedBetaSourceTree({
    version: "0.3.1",
    proof,
    betaTagSha: betaSha,
    changedPathsSinceBeta: ["package.json", "package-lock.json", "CHANGELOG.md"],
    betaPackageJsonText: JSON.stringify(basePkg),
    releasePackageJsonText: JSON.stringify(scriptChangedPkg),
    betaPackageLockText: JSON.stringify(baseLock),
    releasePackageLockText: JSON.stringify(cleanReleaseLock),
  });
  assert.equal(scriptResult.ok, false);
  assert.equal(scriptResult.code, "unapproved_package_metadata_change");
  assert.match(scriptResult.message, /package\.json modified non-version fields.*scripts/);

  // 4. Lockfile resolved/integrity change is rejected
  const lockTampered = structuredClone(cleanReleaseLock);
  lockTampered.packages["node_modules/stripe"].resolved = "https://evil.example/stripe.tgz";
  lockTampered.packages["node_modules/stripe"].integrity = "sha512-tampered==";
  const lockResult = verifyApprovedBetaSourceTree({
    version: "0.3.1",
    proof,
    betaTagSha: betaSha,
    changedPathsSinceBeta: ["package.json", "package-lock.json", "CHANGELOG.md"],
    betaPackageJsonText: JSON.stringify(basePkg),
    releasePackageJsonText: JSON.stringify(cleanReleasePkg),
    betaPackageLockText: JSON.stringify(baseLock),
    releasePackageLockText: JSON.stringify(lockTampered),
  });
  assert.equal(lockResult.ok, false);
  assert.equal(lockResult.code, "unapproved_package_metadata_change");
  assert.match(lockResult.message, /package-lock\.json modified non-version fields.*packages/);

  // 5. Malformed JSON is rejected
  const malformedJsonResult = verifyVersionOnlyPackageMetadata({
    version: "0.3.1",
    betaPackageJsonText: JSON.stringify(basePkg),
    releasePackageJsonText: "{bad-json",
    betaPackageLockText: JSON.stringify(baseLock),
    releasePackageLockText: JSON.stringify(cleanReleaseLock),
  });
  assert.equal(malformedJsonResult.ok, false);
  assert.equal(malformedJsonResult.code, "unapproved_package_metadata_change");
  assert.match(malformedJsonResult.message, /release package\.json is not valid JSON/);

  // 6. Disallowed file path is still rejected
  const tamperedSource = verifyApprovedBetaSourceTree({
    version: "0.3.1",
    proof,
    betaTagSha: betaSha,
    changedPathsSinceBeta: ["package.json", "CHANGELOG.md", "src/plugin.ts"],
  });
  assert.equal(tamperedSource.ok, false);
  assert.equal(tamperedSource.code, "unapproved_source_changes_since_beta");
  assert.deepEqual(tamperedSource.disallowedPaths, ["src/plugin.ts"]);
});

test("verifyVersionOnlyPluginManifest lets the release PR sync emdash-plugin.jsonc's version and nothing else", () => {
  const betaSha = "abcdef1234567890abcdef1234567890abcdef12";
  const proof = { betaVersion: "0.3.1-beta.1", betaSha, proofRef: "run-999 0.3.1-beta.1 @running pass" };
  const betaManifest = {
    slug: STABLE_REGISTRY_SLUG,
    version: "0.3.0",
    publisher: TEST_PUBLISHER,
    capabilities: ["network:request"],
  };
  const releaseManifest = { ...betaManifest, version: "0.3.1" };
  const tree = (release) => verifyApprovedBetaSourceTree({
    version: "0.3.1",
    proof,
    betaTagSha: betaSha,
    changedPathsSinceBeta: ["package.json", "emdash-plugin.jsonc", "CHANGELOG.md"],
    betaManifestText: JSON.stringify(betaManifest),
    releaseManifestText: JSON.stringify(release),
  });

  assert.equal(isAllowedReleaseTreePath("emdash-plugin.jsonc"), true);
  assert.equal(tree(releaseManifest).ok, true);

  const widened = tree({ ...releaseManifest, capabilities: ["network:request", "users:read"] });
  assert.equal(widened.ok, false);
  assert.equal(widened.code, "unapproved_plugin_manifest_change");
  assert.match(widened.message, /emdash-plugin\.jsonc modified non-version fields.*capabilities/);

  const unsynced = tree(betaManifest);
  assert.equal(unsynced.ok, false);
  assert.match(unsynced.message, /release emdash-plugin\.jsonc version is "0\.3\.0" \(expected "0\.3\.1"\)/);

  const malformed = verifyVersionOnlyPluginManifest({
    version: "0.3.1",
    betaManifestText: JSON.stringify(betaManifest),
    releaseManifestText: "{bad-json",
  });
  assert.equal(malformed.ok, false);
  assert.match(malformed.message, /release emdash-plugin\.jsonc is not valid JSON/);
});

test("stamp-beta-version writes only a beta version into package.json and emdash-plugin.jsonc", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-stamp-beta-"));
  try {
    await writeFile(join(root, "package.json"), `${JSON.stringify({ name: PACKAGE_NAME, version: "0.3.0" }, null, 2)}\n`);
    await writePublisherManifest(root);
    const result = await runReleaseFlowCli(["stamp-beta-version", "--version", "0.4.0-beta.1"], { root, log: () => {} });
    assert.deepEqual(result, { version: "0.4.0-beta.1", stamped: ["package.json", "emdash-plugin.jsonc"] });
    assert.equal(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, "0.4.0-beta.1");
    const manifest = JSON.parse(await readFile(join(root, "emdash-plugin.jsonc"), "utf8"));
    assert.deepEqual(manifest, { slug: STABLE_REGISTRY_SLUG, version: "0.4.0-beta.1", publisher: TEST_PUBLISHER });

    for (const version of ["0.4.0", "", "later"]) {
      await assert.rejects(
        () => runReleaseFlowCli(["stamp-beta-version", "--version", version], { root, log: () => {} }),
        /X\.Y\.Z-beta\.N|Invalid semantic version/,
      );
    }
    assert.equal(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, "0.4.0-beta.1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const released of [false, true]) {
test(`verify-release-tag accepts a stable tag on its release branch and ${released ? "keeps" : "creates"} its GitHub Release`, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "commerce-tag-run-test-"));
  try {
    await writePublisherManifest(tempRoot);
    await mkdir(join(tempRoot, ".changeset"), { recursive: true });
    await mkdir(join(tempRoot, "src"), { recursive: true });
    await writeFile(
      join(tempRoot, "package.json"),
      `${JSON.stringify({ name: PACKAGE_NAME, version: "0.3.0", type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(tempRoot, "package-lock.json"),
      `${JSON.stringify({ name: PACKAGE_NAME, version: "0.3.0", packages: { "": { name: PACKAGE_NAME, version: "0.3.0" } } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(tempRoot, "CHANGELOG.md"), "# @dinkuskit/commerce\n\n## 0.3.0\n\n- Baseline.\n", "utf8");
    await writeFile(join(tempRoot, "src/plugin.ts"), "export const x = 1;\n", "utf8");
    await writeFile(join(tempRoot, ".changeset/README.md"), "# Changesets\n", "utf8");

    const git = (args) =>
      execFileSync("git", args, { cwd: tempRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

    git(["init", "-b", "release/0.3.1"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.invalid"]);
    git(["add", "-A"]);
    git(["commit", "-m", "feat: beta state"]);
    git(["tag", "v0.3.1-beta.1"]);
    const betaSha = git(["rev-parse", "HEAD"]);

    await writeFile(
      join(tempRoot, "package.json"),
      `${JSON.stringify({ name: PACKAGE_NAME, version: "0.3.1", type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(tempRoot, "package-lock.json"),
      `${JSON.stringify({ name: PACKAGE_NAME, version: "0.3.1", packages: { "": { name: PACKAGE_NAME, version: "0.3.1" } } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(tempRoot, "CHANGELOG.md"), "# @dinkuskit/commerce\n\n## 0.3.1\n\n- Patch fix.\n\n## 0.3.0\n\n- Baseline.\n", "utf8");
    await writePublisherManifest(tempRoot, "0.3.1");
    git(["add", "package.json", "package-lock.json", "emdash-plugin.jsonc", "CHANGELOG.md"]);
    const trailer = formatBetaProofRecord({ betaVersion: "0.3.1-beta.1", betaSha, proofRef: "run-123 (0.3.1-beta.1 @running pass)" });
    git(["commit", "-m", `ci: release v0.3.1\n\n${trailer}`]);
    git(["tag", "v0.3.1", "HEAD"]);

    const ghCalls = [];
    const outputFile = join(tempRoot, "github-output.txt");
    const result = await runReleaseFlowCli(["verify-release-tag", "--ref", "refs/tags/v0.3.1", "--github-output", outputFile], {
      root: tempRoot,
      gitExec: (args, cwd = tempRoot) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim(),
      ghExec: (args) => {
        ghCalls.push(args);
        if (args[0] === "release" && args[1] === "view" && !released) throw new Error("release not found");
        return "";
      },
      log: () => {},
    });

    assert.equal(result.releaseMode, "stable");
    assert.equal(result.slug, STABLE_REGISTRY_SLUG);
    assert.equal(result.betaVersion, "0.3.1-beta.1");
    assert.equal(result.githubReleaseCreated, !released);
    assert.equal(ghCalls.some((args) => args[0] === "release" && args[1] === "create"), !released);
    const ghOutputText = await readFile(outputFile, "utf8");
    assert.match(ghOutputText, /^release_mode=stable$/m);
    assert.match(ghOutputText, /^version=0\.3\.1$/m);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
}

test("extractChangelogSection extracts the matching version notes", () => {
  const changelog = [
    "# @dinkuskit/commerce",
    "",
    "## 0.3.1",
    "",
    "### Patch Changes",
    "",
    "- Harden webhook replay handling.",
    "",
    "## 0.3.0",
    "",
    "- Initial baseline.",
  ].join("\n");

  assert.equal(
    extractChangelogSection(changelog, "0.3.1"),
    "### Patch Changes\n\n- Harden webhook replay handling.",
  );
  assert.equal(extractChangelogSection(changelog, "0.3.0"), "- Initial baseline.");
  assert.equal(extractChangelogSection(changelog, "0.9.9"), null);
});

test("release-authority-proof harness passes all 15 release-authority scenarios (a)-(o)", async () => {
  const report = await runReleaseAuthorityProof();
  assert.equal(report.allPassed, true);
  assert.equal(report.scenarioCount, 15);
  assert.deepEqual(
    report.scenarios.map((s) => s.id),
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o"],
  );
});
