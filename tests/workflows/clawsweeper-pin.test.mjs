import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
	"../../.github/workflows/clawsweeper-comment-trigger.yml",
	import.meta.url,
);

test("pins the ClawSweeper caller and engine to one immutable commit", async () => {
	const source = await readFile(workflowUrl, "utf8");
	const callerPins = [
		...source.matchAll(
			/^\s*uses:\s+dinkuskit\/clawsweeper\/\.github\/workflows\/dinkuskit-native-canary\.yml@([0-9a-f]{40})\s*$/gm,
		),
	].map((match) => match[1]);
	const enginePins = [
		...source.matchAll(/^\s*engine_sha:\s*([0-9a-f]{40})\s*$/gm),
	].map((match) => match[1]);

	assert.equal(callerPins.length, 1);
	assert.equal(enginePins.length, 1);
	assert.equal(callerPins[0], enginePins[0]);
});
