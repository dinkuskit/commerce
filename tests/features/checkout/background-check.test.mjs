import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_CHECK_REGISTER_BUDGET_MS,
  BACKGROUND_CHECK_RETRY_MS,
  BACKGROUND_CHECK_SCHEDULE,
  COMMERCE_CHECKOUT_WAKES_TASK,
  ensureBackgroundCheck,
  resetBackgroundCheckForTest,
  withBackgroundCheck,
} from "../../../dist/features/checkout/index.js";

const TASK = { name: COMMERCE_CHECKOUT_WAKES_TASK, schedule: BACKGROUND_CHECK_SCHEDULE };

// A site scheduler that records calls; each call takes the next scripted answer, or succeeds.
function scheduler(...answers) {
  const tasks = [], calls = [], warnings = [];
  const answer = async (method, write) => {
    calls.push(method);
    const next = answers.shift();
    if (next) await next();
    write?.();
  };
  const ctx = {
    cron: {
      list: async () => { await answer("list"); return tasks.map(task => ({ ...task })); },
      schedule: (name, opts) => answer("schedule", () => {
        const kept = tasks.find(task => task.name === name);
        if (kept) kept.schedule = opts.schedule; else tasks.push({ name, schedule: opts.schedule });
      }),
    },
    log: { warn: (message, data) => warnings.push([message, data]) },
  };
  return { ctx, tasks, calls, warnings };
}
const fail = () => { throw new Error("synthetic scheduler outage with a secret-looking dk_store_value"); };
function stall() {
  let release, refuse;
  const promise = new Promise((resolve, reject) => { release = resolve; refuse = reject; });
  return { answer: () => promise, release, refuse };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test.beforeEach(() => resetBackgroundCheckForTest());

test("switching on registers the 5-minute check every time; requests then leave the scheduler alone", async () => {
  const site = scheduler();
  assert.equal(await ensureBackgroundCheck(site.ctx, true), true);
  assert.equal(await ensureBackgroundCheck(site.ctx, true), true);
  assert.deepEqual(site.tasks, [TASK]);
  assert.deepEqual(site.calls, ["schedule", "schedule"]);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["schedule", "schedule"]);
});

test("without a site scheduler, nothing is called and nothing throws", async () => {
  assert.equal(await ensureBackgroundCheck({ log: { warn() {} } }, true), false);
  assert.equal(await ensureBackgroundCheck({ log: { warn() {} } }), false);
});

test("a refused switch-on resolves and the next request registers the check", async () => {
  const site = scheduler(fail);
  assert.equal(await ensureBackgroundCheck(site.ctx, true), false);
  assert.deepEqual(site.tasks, []);
  // Logged without the scheduler's error, which could carry anything.
  assert.deepEqual(site.warnings.map(([, data]) => data), [{ reason: "failed" }]);
  assert.doesNotMatch(JSON.stringify(site.warnings), /dk_store_|outage/);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["schedule", "list", "schedule"]);
  assert.deepEqual(site.tasks, [TASK]);
  await ensureBackgroundCheck(site.ctx);
  assert.equal(site.calls.length, 3);
});

test("a request that finds the check already registered writes nothing", async () => {
  const site = scheduler();
  site.tasks.push({ ...TASK });
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["list"]);
});

test("a request rewrites a check registered at another cadence", async () => {
  const site = scheduler();
  site.tasks.push({ name: COMMERCE_CHECKOUT_WAKES_TASK, schedule: "0 * * * *" });
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["list", "schedule"]);
  assert.deepEqual(site.tasks, [TASK]);
});

test("a stalled switch-on gives up at the budget, and a late success still counts", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const held = stall();
  const site = scheduler(held.answer);
  const activated = ensureBackgroundCheck(site.ctx, true);
  t.mock.timers.tick(BACKGROUND_CHECK_REGISTER_BUDGET_MS - 1);
  await settle();
  let done = false;
  activated.then(() => { done = true; });
  await settle();
  assert.equal(done, false);
  t.mock.timers.tick(1);
  assert.equal(await activated, false);
  assert.deepEqual(site.warnings.map(([, data]) => data), [{ reason: "timeout" }]);
  // The scheduler answers late; the check is registered and requests make no calls.
  held.release();
  await settle();
  assert.deepEqual(site.tasks, [TASK]);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["schedule"]);
});

test("a stalled request answers at the budget; requests wait a minute before trying again", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const held = stall();
  const site = scheduler(held.answer);
  const first = ensureBackgroundCheck(site.ctx);
  t.mock.timers.tick(BACKGROUND_CHECK_REGISTER_BUDGET_MS);
  assert.equal(await first, false);
  // A late refusal is handled: nothing is left unobserved and the state stays unregistered.
  held.refuse(new Error("late"));
  await settle();
  assert.deepEqual(site.warnings.map(([, data]) => data), [{ reason: "timeout" }, { reason: "failed" }]);
  assert.equal(await ensureBackgroundCheck(site.ctx), false);
  assert.deepEqual(site.calls, ["list"]);
  t.mock.timers.tick(BACKGROUND_CHECK_RETRY_MS);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["list", "list", "schedule"]);
  assert.deepEqual(site.tasks, [TASK]);
});

test("concurrent requests make one attempt between them and leave one task", async () => {
  const site = scheduler();
  const answers = await Promise.all([ensureBackgroundCheck(site.ctx), ensureBackgroundCheck(site.ctx), ensureBackgroundCheck(site.ctx)]);
  assert.deepEqual(answers, [true, false, false]);
  assert.deepEqual(site.calls, ["list", "schedule"]);
  assert.deepEqual(site.tasks, [TASK]);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
});

test("a route keeps its own answer and failure whatever the scheduler does", async () => {
  const site = scheduler(fail);
  const route = withBackgroundCheck(async (input, ctx) => ({ input, same: ctx === site.ctx }));
  assert.deepEqual(await route("hello", site.ctx), { input: "hello", same: true });
  const broken = withBackgroundCheck(async () => { throw new Error("route failure"); });
  await assert.rejects(broken({}, site.ctx), /route failure/);
});

// commerce#197 case A: a try still hanging when the minute is up. Each fake-clock step is explicit;
// nothing here waits on real time.
test("a try still hanging after the minute lets the next one run, and its late failure keeps the newer success", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const first = stall();
  const site = scheduler(first.answer);
  const a = ensureBackgroundCheck(site.ctx);
  t.mock.timers.tick(BACKGROUND_CHECK_REGISTER_BUDGET_MS);
  assert.equal(await a, false);
  t.mock.timers.tick(BACKGROUND_CHECK_RETRY_MS);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.tasks, [TASK]);
  // The first try's list call finally fails, after the second registered the check.
  first.refuse(new Error("late"));
  await settle();
  t.mock.timers.tick(BACKGROUND_CHECK_RETRY_MS);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["list", "list", "schedule"]);
  assert.deepEqual(site.tasks, [TASK]);
});

test("an old try that succeeds late while a newer one hangs counts, and the newer one's late failure keeps it", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const first = stall(), second = stall();
  const site = scheduler(first.answer, second.answer);
  const a = ensureBackgroundCheck(site.ctx);
  t.mock.timers.tick(BACKGROUND_CHECK_REGISTER_BUDGET_MS);
  assert.equal(await a, false);
  t.mock.timers.tick(BACKGROUND_CHECK_RETRY_MS);
  const b = ensureBackgroundCheck(site.ctx);
  t.mock.timers.tick(BACKGROUND_CHECK_REGISTER_BUDGET_MS);
  assert.equal(await b, false);
  first.release();
  await settle();
  second.refuse(new Error("late"));
  await settle();
  assert.deepEqual(site.tasks, [TASK]);
  t.mock.timers.tick(BACKGROUND_CHECK_RETRY_MS);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["list", "list", "schedule"]);
});

test("a scheduler that never answers costs at most one call a minute, and no request waits past the budget", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const never = () => new Promise(() => {});
  const site = scheduler(...Array.from({ length: 10 }, () => never));
  for (let minute = 0; minute < 10; minute++) {
    for (let request = 0; request < 5; request++) {
      const answer = ensureBackgroundCheck(site.ctx);
      t.mock.timers.tick(BACKGROUND_CHECK_REGISTER_BUDGET_MS);
      assert.equal(await answer, false);
    }
    t.mock.timers.tick(BACKGROUND_CHECK_RETRY_MS);
  }
  assert.equal(site.calls.length, 10);
  assert.deepEqual(site.tasks, []);
  // Once the scheduler answers again, the next try registers the check.
  site.ctx.cron.list = async () => [];
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.tasks, [TASK]);
});


test("switching on again forgets the earlier registration, so after a refused switch-on the next request checks", async () => {
  const site = scheduler(async () => {}, fail);
  assert.equal(await ensureBackgroundCheck(site.ctx, true), true);
  assert.equal(await ensureBackgroundCheck(site.ctx, true), false);
  assert.equal(await ensureBackgroundCheck(site.ctx), true);
  assert.deepEqual(site.calls, ["schedule", "schedule", "list"]);
  assert.deepEqual(site.tasks, [TASK]);
});
