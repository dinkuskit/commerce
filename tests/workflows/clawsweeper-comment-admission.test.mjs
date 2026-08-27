import assert from "node:assert/strict";
import test from "node:test";

import {
	admitCandidate,
	commentCandidate,
	parseReviewCommand,
} from "../../scripts/clawsweeper-comment-admission.mjs";

const pullBaseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const liveBaseSha = "c".repeat(40);

function event(overrides = {}) {
	return {
		action: "created",
		repository: {
			full_name: "dinkuskit/commerce",
			id: 1347692514,
			default_branch: "main",
		},
		issue: { number: 22, pull_request: {} },
		comment: {
			body: "Context for the reviewer.\n\n@clawsweeper review",
			author_association: "OWNER",
			user: { login: "dinkuskit", type: "User" },
		},
		...overrides,
	};
}

function pull(overrides = {}) {
	return {
		number: 22,
		state: "open",
		user: { login: "contributor" },
		base: {
			ref: "main",
			sha: pullBaseSha,
			repo: { full_name: "dinkuskit/commerce" },
		},
		head: { sha: headSha },
		...overrides,
	};
}

function defaultBranchReference(overrides = {}) {
	return {
		ref: "refs/heads/main",
		object: { type: "commit", sha: liveBaseSha },
		...overrides,
	};
}

test("recognizes one exact command line inside a longer comment", () => {
	assert.equal(parseReviewCommand("proof\r\n  @clawsweeper re-review  \r\n"), "re-review");
	assert.equal(parseReviewCommand("please use @clawsweeper review now"), null);
	assert.equal(
		parseReviewCommand("@clawsweeper review\n@clawsweeper re-run"),
		null,
	);
});

test("binds the live default-branch SHA when the pull request base snapshot is stale", () => {
	const candidate = commentCandidate(event());
	assert.ok(candidate);
	assert.deepEqual(admitCandidate(candidate, pull(), defaultBranchReference()), {
		requested: true,
		prNumber: 22,
		baseSha: liveBaseSha,
		headSha,
	});
});

test("lets the exact PR author request a fresh read-only re-review", () => {
	const candidate = commentCandidate(
		event({
			comment: {
				body: "@clawsweeper re-run",
				author_association: "CONTRIBUTOR",
				user: { login: "contributor", type: "User" },
			},
		}),
	);
	assert.ok(candidate);
	assert.ok(admitCandidate(candidate, pull(), defaultBranchReference()));
});

test("does not let an untrusted contributor start review or rerun another PR", () => {
	const review = commentCandidate(
		event({
			comment: {
				body: "@clawsweeper review",
				author_association: "CONTRIBUTOR",
				user: { login: "contributor", type: "User" },
			},
		}),
	);
	const rerun = commentCandidate(
		event({
			comment: {
				body: "@clawsweeper re-review",
				author_association: "NONE",
				user: { login: "someone-else", type: "User" },
			},
		}),
	);
	assert.ok(review);
	assert.ok(rerun);
	assert.equal(admitCandidate(review, pull(), defaultBranchReference()), null);
	assert.equal(admitCandidate(rerun, pull(), defaultBranchReference()), null);
});

test("ignores bots, non-PR comments, wrong repository identity, and edited comments", () => {
	assert.equal(
		commentCandidate(
			event({
				comment: {
					body: "@clawsweeper review",
					author_association: "OWNER",
					user: { login: "automation-bot", type: "Bot" },
				},
			}),
		),
		null,
	);
	assert.equal(commentCandidate(event({ issue: { number: 22 } })), null);
	assert.equal(
		commentCandidate(
			event({
				repository: {
					full_name: "attacker/commerce",
					id: 1347692514,
					default_branch: "main",
				},
			}),
		),
		null,
	);
	assert.equal(
		commentCandidate(
			event({
				repository: {
					full_name: "dinkuskit/commerce",
					id: 1347692515,
					default_branch: "main",
				},
			}),
		),
		null,
	);
	assert.equal(
		commentCandidate(
			event({
				repository: {
					full_name: "dinkuskit/commerce",
					id: 1347692514,
					default_branch: "release",
				},
			}),
		),
		null,
	);
	assert.equal(commentCandidate(event({ action: "edited" })), null);
});

test("fails closed when the live PR is closed, moved, or malformed", () => {
	const candidate = commentCandidate(event());
	assert.ok(candidate);
	assert.equal(
		admitCandidate(candidate, pull({ state: "closed" }), defaultBranchReference()),
		null,
	);
	assert.equal(
		admitCandidate(
			candidate,
			pull({
				base: {
					ref: "release",
					sha: pullBaseSha,
					repo: { full_name: "dinkuskit/commerce" },
				},
			}),
			defaultBranchReference(),
		),
		null,
	);
	assert.equal(
		admitCandidate(
			candidate,
			pull({ head: { sha: "not-a-sha" } }),
			defaultBranchReference(),
		),
		null,
	);
});

test("fails closed when the live default-branch ref is missing or malformed", () => {
	const candidate = commentCandidate(event());
	assert.ok(candidate);
	assert.equal(admitCandidate(candidate, pull(), undefined), null);
	assert.equal(
		admitCandidate(
			candidate,
			pull(),
			defaultBranchReference({ ref: "refs/heads/release" }),
		),
		null,
	);
	assert.equal(
		admitCandidate(
			candidate,
			pull(),
			defaultBranchReference({ object: { type: "commit", sha: "not-a-sha" } }),
		),
		null,
	);
	assert.equal(
		admitCandidate(
			candidate,
			pull(),
			defaultBranchReference({ object: { type: "tag", sha: liveBaseSha } }),
		),
		null,
	);
});
