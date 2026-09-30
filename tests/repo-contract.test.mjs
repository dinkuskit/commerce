import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { auditRepository, repositoryRoot } from "../scripts/repo-contract.mjs";

const requiredPublicFiles = [
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
  "bin/verify-commerce",
];

const requiredPublicManifest = {
  name: "@dinkuskit/commerce",
  version: "0.0.0",
  private: true,
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/dinkuskit/commerce.git",
  },
  files: ["dist", "emdash-plugin.jsonc"],
  peerDependencies: {
    emdash: "0.41.0",
  },
  dinkuskit: {
    emdashCompatibility: {
      apiPeer: "0.41.0",
      mountedSitePilot: "private",
      requiredSourceVisibility: "public",
      requiredSourceRepository: "https://github.com/saariuslystoned/emdash",
      requiredCommit: "4c1f21900f3a28e9a270e64111f4979bce74926e",
      upstreamPullRequest: "https://github.com/emdash-cms/emdash/pull/2768",
      stockReleaseBehavior: "fail-closed",
      stableReleaseExit: "repin-and-rerun-smokyclub-proof",
    },
  },
};

async function writeFileAt(root, relativePath, contents) {
  const absolute = join(root, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
}

async function withSyntheticPublicRoot(extraFiles, run) {
  const root = await mkdtemp(join(tmpdir(), "commerce-repo-contract-"));
  try {
    for (const path of requiredPublicFiles) {
      await writeFileAt(root, path, "public-audit fixture\n");
    }
    await writeFileAt(root, "package.json", `${JSON.stringify(requiredPublicManifest, null, 2)}\n`);
    for (const [path, contents] of Object.entries(extraFiles)) {
      await writeFileAt(root, path, contents);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the committed scaffold satisfies the public repository contract", async () => {
  assert.deepEqual(await auditRepository(repositoryRoot), []);
});

test("ignored GrillTrack work and build or browser output stay outside the public audit", async () => {
  await withSyntheticPublicRoot(
    {
      ".grilltrack/work/plans/note.txt": "ignored work fixture\n",
      ".grilltrack/work/runs/note.txt": "ignored work fixture\n",
      "dist/.env": "PUBLIC_AUDIT_SENTINEL\n",
      "dist/out.sql": "-- build fixture\n",
      ".tmp/sandbox-proof/browser.png": "browser-output-sentinel\n",
    },
    async (root) => {
      assert.deepEqual(await auditRepository(root), []);
    },
  );
});

test("forbidden public paths outside working output remain rejected", async () => {
  await withSyntheticPublicRoot(
    {
      ".grilltrack/proof/fixture.sql": "-- public-audit fixture\n",
      "src/.env": "PUBLIC_AUDIT_SENTINEL\n",
    },
    async (root) => {
      const findings = await auditRepository(root);
      assert.ok(findings.includes("forbidden SQL path: .grilltrack/proof/fixture.sql"));
      assert.ok(findings.includes("forbidden public path: src/.env"));
    },
  );
});
