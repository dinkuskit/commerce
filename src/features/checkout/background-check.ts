import type { PluginContext } from "emdash";
import { COMMERCE_CHECKOUT_WAKES_TASK } from "./installed.js";

export const BACKGROUND_CHECK_SCHEDULE = "*/5 * * * *";
// Below EmDash's 5-second default hook limit: a hook that outruns it counts as failed.
export const BACKGROUND_CHECK_REGISTER_BUDGET_MS = 3_000;
// After a failed or stalled attempt, requests leave the scheduler alone this long.
export const BACKGROUND_CHECK_RETRY_MS = 60_000;

const NOT_REGISTERED = "Commerce background check is not registered yet; a later request will try again";

// Per isolate. A task that was never registered cannot run itself, so requests keep
// trying until the site scheduler holds it; once it does, they make no more calls.
let registered = false;
let retryAt = 0;

/**
 * Registers the 5-minute background check with the site scheduler, never throwing and
 * never waiting longer than the budget. Switching Commerce on always writes the task,
 * since EmDash disables a switched-off plugin's tasks; a request only reads the
 * scheduler's list and writes when the task is missing. A late answer still counts:
 * success stops further attempts, and a failure is logged without its details.
 */
export async function ensureBackgroundCheck(ctx: PluginContext, activate = false): Promise<boolean> {
  const cron = ctx.cron;
  if (!cron || (!activate && (registered || Date.now() < retryAt))) return registered;
  // Switching on is a one-off, so its failure leaves the next request free to try.
  retryAt = activate ? 0 : Date.now() + BACKGROUND_CHECK_RETRY_MS;
  const attempt = register(cron, activate).then(() => (registered = true), () => {
    registered = false;
    ctx.log.warn(NOT_REGISTERED, { reason: "failed" });
    return false;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>(resolve => {
    timer = setTimeout(() => {
      ctx.log.warn(NOT_REGISTERED, { reason: "timeout" });
      resolve(false);
    }, BACKGROUND_CHECK_REGISTER_BUDGET_MS);
  });
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function register(cron: NonNullable<PluginContext["cron"]>, activate: boolean): Promise<void> {
  if (!activate && (await cron.list()).some(task =>
    task.name === COMMERCE_CHECKOUT_WAKES_TASK && task.schedule === BACKGROUND_CHECK_SCHEDULE)) return;
  await cron.schedule(COMMERCE_CHECKOUT_WAKES_TASK, { schedule: BACKGROUND_CHECK_SCHEDULE });
}

/** Wraps a route so reaching it also makes sure the background check is registered. */
export function withBackgroundCheck<A, R>(handler: (route: A, ctx: PluginContext) => R | Promise<R>) {
  return async (route: A, ctx: PluginContext): Promise<R> => {
    await ensureBackgroundCheck(ctx);
    return handler(route, ctx);
  };
}

/** Test seam: forget this isolate's registration state. */
export function resetBackgroundCheckForTest(): void {
  registered = false;
  retryAt = 0;
}
