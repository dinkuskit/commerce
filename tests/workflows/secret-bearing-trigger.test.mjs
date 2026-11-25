import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	auditWorkflow,
	auditWorkflowDirectory,
	workflowTriggers,
} from "../../.github/scripts/check-workflow-triggers.mjs";

const workflowsDirectory = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));
const dispatch = readFileSync(join(workflowsDirectory, "clawsweeper-dispatch.yml"), "utf8");

const gate = `  gate:
    if: github.event.comment.author_association == 'OWNER'
    runs-on: ubuntu-latest
    outputs:
      allowed: \${{ steps.check.outputs.allowed }}
    steps:
      - id: check
        run: gh api "repos/$REPO/collaborators/$ACTOR/permission"
`;

function workflow({ on = "pull_request_target", jobs }) {
	return `name: Fixture\n\non:\n  ${on}:\n\npermissions: {}\n\njobs:\n${jobs}`;
}

const call = (extra = "") => `  review:
${extra}    uses: example/reviewer/.github/workflows/review.yml@${"a".repeat(40)}
    secrets:
      REVIEW_TOKEN: \${{ secrets.REVIEW_TOKEN }}
`;

test("every committed workflow gates secrets behind a permission check on untrusted triggers", () => {
	assert.deepEqual(auditWorkflowDirectory(workflowsDirectory), []);
	assert.deepEqual(workflowTriggers(dispatch), ["pull_request_target", "issue_comment", "workflow_dispatch"]);
});

test("refuses a secret-bearing reusable call with no gate job", () => {
	for (const on of ["pull_request_target", "issue_comment"]) {
		const [finding] = auditWorkflow("fixture.yml", workflow({ on, jobs: call() }));
		assert.match(finding, new RegExp(`job review passes secrets to example/reviewer/.* on ${on}`));
	}
	const inherit = workflow({ jobs: call().replace(/secrets:\n.*\n/, "secrets: inherit\n") });
	assert.equal(auditWorkflow("fixture.yml", inherit).length, 1);
	const viaInput = workflow({
		jobs: call().replace(/secrets:\n/, "with:\n").replace("REVIEW_TOKEN:", "token:"),
	});
	assert.equal(auditWorkflow("fixture.yml", viaInput).length, 1);
});

test("refuses a gate that is not needed, not read, or not a permission check", () => {
	const gated = "    needs: gate\n    if: needs.gate.outputs.allowed == 'true'\n";
	assert.deepEqual(auditWorkflow("fixture.yml", workflow({ jobs: gate + call(gated) })), []);
	// Runs after the gate but ignores its answer.
	const unread = workflow({ jobs: gate + call("    needs: gate\n") });
	assert.equal(auditWorkflow("fixture.yml", unread).length, 1);
	// Reads an output of a job it does not need.
	const unneeded = workflow({ jobs: gate + call("    if: needs.gate.outputs.allowed == 'true'\n") });
	assert.equal(auditWorkflow("fixture.yml", unneeded).length, 1);
	// The gate never looks at who triggered the run.
	const noCheck = gate
		.replace("author_association == 'OWNER'", "github.event.action == 'opened'")
		.replace('gh api "repos/$REPO/collaborators/$ACTOR/permission"', "echo allowed=true");
	assert.equal(auditWorkflow("fixture.yml", workflow({ jobs: noCheck + call(gated) })).length, 1);
	// An allowlist that admits any account is not a gate.
	const anyone = gate.replace(
		"author_association == 'OWNER'",
		`contains(fromJSON('["OWNER", "CONTRIBUTOR", "NONE"]'), github.event.comment.author_association)`,
	);
	assert.equal(auditWorkflow("fixture.yml", workflow({ jobs: anyone + call(gated) })).length, 1);
	// needs: in list form is understood.
	const listed = "    needs: [gate]\n    if: needs.gate.outputs.allowed == 'true'\n";
	assert.deepEqual(auditWorkflow("fixture.yml", workflow({ jobs: gate + call(listed) })), []);
});

test("leaves trusted triggers alone", () => {
	assert.deepEqual(auditWorkflow("fixture.yml", workflow({ on: "pull_request", jobs: call() })), []);
	assert.deepEqual(auditWorkflow("fixture.yml", `on: [push, workflow_dispatch]\njobs:\n${call()}`), []);
	assert.equal(auditWorkflow("fixture.yml", `on: [push, issue_comment]\njobs:\n${call()}`).length, 1);
});

test("the ClawSweeper review job only reaches its reusable workflow through the bind gate", () => {
	const review = dispatch.match(/\n  review:\n([\s\S]*?)$/)?.[1];
	assert.ok(review, "expected a review job in clawsweeper-dispatch.yml");
	assert.match(review, /^ {4}needs: bind$/m);
	assert.match(review, /^ {4}if: needs\.bind\.outputs\.requested == 'true'$/m);
	assert.match(review, /^ {4}uses: dinkuskit\/clawsweeper\//m);
});

// Runs the bind step's own script against fixture events, with `gh api` answered from fixtures,
// to prove a commenter or labeler without permission leaves requested=false, so the
// secret-bearing review job never reaches `uses:`.
function runBind({ eventName, event, collaboratorPermission = "read" }) {
	const script = dispatch.match(/<<'PYBIND'\n([\s\S]*?)\n {10}PYBIND\n/)?.[1];
	assert.ok(script, "expected the PYBIND bind script in clawsweeper-dispatch.yml");
	const targetId = dispatch.match(/TARGET_ID: '(\d+)'/)[1];
	const directory = mkdtempSync(join(tmpdir(), "secret-bearing-trigger-"));
	try {
		const number = (event.pull_request ?? event.issue).number;
		const answers = {
			"repos/dinkuskit/commerce": { id: Number(targetId), default_branch: "main" },
			[`repos/dinkuskit/commerce/pulls/${number}`]: {
				state: "open",
				draft: false,
				user: { login: "pr-author", type: "User" },
				base: { ref: "main", sha: "a".repeat(40), repo: { id: Number(targetId) } },
				head: { sha: "b".repeat(40) },
			},
			[`repos/dinkuskit/commerce/collaborators/${event.sender?.login}/permission`]: {
				permission: collaboratorPermission,
			},
		};
		writeFileSync(join(directory, "answers.json"), JSON.stringify(answers));
		writeFileSync(
			join(directory, "gh"),
			`#!/usr/bin/env node\nconst answers = JSON.parse(require("node:fs").readFileSync(${JSON.stringify(join(directory, "answers.json"))}, "utf8"));\nconst answer = answers[process.argv[3]];\nif (process.argv[2] !== "api" || !answer) process.exit(1);\nprocess.stdout.write(JSON.stringify(answer));\n`,
		);
		chmodSync(join(directory, "gh"), 0o755);
		writeFileSync(join(directory, "bind.py"), script.replace(/^ {10}/gm, ""));
		writeFileSync(join(directory, "event.json"), JSON.stringify(event));
		writeFileSync(join(directory, "output"), "");
		execFileSync("python3", ["-I", join(directory, "bind.py")], {
			env: {
				PATH: `${directory}${delimiter}${process.env.PATH}`,
				GITHUB_EVENT_NAME: eventName,
				GITHUB_EVENT_PATH: join(directory, "event.json"),
				GITHUB_OUTPUT: join(directory, "output"),
				GH_TOKEN: "fixture",
				TARGET_REPO: "dinkuskit/commerce",
				TARGET_ID: targetId,
				PR_NUMBER: String(number),
				MANUAL_PUBLISH: "",
			},
		});
		return Object.fromEntries(
			readFileSync(join(directory, "output"), "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => line.split(/=(.*)/s).slice(0, 2)),
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

const comment = (author_association, login) => ({
	action: "created",
	issue: { number: 22, pull_request: { url: "https://api.github.com/repos/dinkuskit/commerce/pulls/22" } },
	comment: { body: "@clawsweeper review", author_association, user: { login, type: "User" } },
	sender: { login, type: "User" },
});

const label = (login) => ({
	action: "labeled",
	label: { name: "clawsweeper:review" },
	pull_request: { number: 22 },
	sender: { login, type: "User" },
});

test("a non-author without write access is rejected before the review job's uses:", () => {
	for (const association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR"]) {
		assert.deepEqual(
			runBind({ eventName: "issue_comment", event: comment(association, "drive-by") }),
			{ requested: "false" },
		);
	}
	assert.deepEqual(
		runBind({ eventName: "pull_request_target", event: label("drive-by"), collaboratorPermission: "read" }),
		{ requested: "false" },
	);
});

test("a maintainer comment or a write-access label still binds the review", () => {
	assert.equal(runBind({ eventName: "issue_comment", event: comment("MEMBER", "maintainer") }).requested, "true");
	const labeled = runBind({
		eventName: "pull_request_target",
		event: label("maintainer"),
		collaboratorPermission: "write",
	});
	assert.equal(labeled.requested, "true");
	assert.equal(labeled.force_label_by, "maintainer");
});
