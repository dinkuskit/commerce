import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
	"../../.github/workflows/clawsweeper-dispatch.yml",
	import.meta.url,
);

test("pins the subscription relay and leaves engine configuration on the host", async () => {
	const source = await readFile(workflowUrl, "utf8");
	const callerPins = [
		...source.matchAll(
			/^\s*uses:\s+dinkuskit\/clawsweeper\/\.github\/workflows\/dinkuskit-native-canary\.yml@([0-9a-f]{40})\s*$/gm,
		),
	].map((match) => match[1]);
	assert.equal(callerPins.length, 1);
	assert.doesNotMatch(source, /^\s*engine_sha:/m);
	assert.doesNotMatch(source, /COPILOT_GITHUB_TOKEN/);
	assert.match(source, /CLAWSWEEPER_DISPATCH_TOKEN/);
});
