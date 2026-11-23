import { isRecord } from "../../shared/record.js";
import { REGISTRY_BUILD } from "../../shared/registry-build.js";
import { reconcileCheckout } from "./orchestrate.js";
import type { PaidOrderHandoffResult } from "./paid-orders.js";
import type {
  CheckoutExecution,
  CheckoutPaymentAssociationPort,
  CheckoutAttempt,
} from "./types.js";

export interface CommercePaymentWake {
  eventId: string;
  attemptId: string;
  bindingRef: string;
  deliveryGeneration: number;
  wokeAt: number;
}

export interface CommercePaymentWakePort {
  list(): Promise<readonly CommercePaymentWake[]>;
  /**
   * Payments must compare the complete event identity: an older ack cannot
   * remove or acknowledge a newer event or delivery for the same attempt.
   */
  acknowledge(wake: CommercePaymentWake): Promise<boolean>;
}

export type WakeReconciliationResult =
  | { wake: CommercePaymentWake; status: "acknowledged"; attempt: CheckoutAttempt }
  | { wake: CommercePaymentWake; status: "retained"; reason: "unknown" | "unavailable" | "missing" | "mismatch" };

/**
 * Trusted server-owned consumer. It accepts no browser input and does not
 * expose a Commerce route. Re-running a wake is safe because reconciliation
 * uses the existing attempt CAS and deterministic order writer.
 */
export async function reconcilePaymentWakes(
  execution: CheckoutExecution,
  associations: CheckoutPaymentAssociationPort,
  wakes: CommercePaymentWakePort,
): Promise<WakeReconciliationResult[]> {
  const results: WakeReconciliationResult[] = [];
  const retain = (wake: CommercePaymentWake, reason: Extract<WakeReconciliationResult, { status: "retained" }>["reason"]) => results.push({ wake, status: "retained", reason });
  let pending: readonly CommercePaymentWake[];
  try {
    pending = await wakes.list();
  } catch {
    return results;
  }
  for (const wake of pending) {
    if (!isWake(wake)) {
      retain(wake, "unknown");
      continue;
    }
    let association;
    try {
      association = await associations.get(wake.attemptId);
    } catch {
      retain(wake, "unavailable");
      continue;
    }
    if (!association) {
      retain(wake, "missing");
      continue;
    }
    if (association.attemptId !== wake.attemptId ||
        association.bindingRef !== wake.bindingRef) {
      retain(wake, "mismatch");
      continue;
    }
    try {
      const stored = await execution.store.read(association.cartId);
      const canonicalAttempt = stored?.record.attempts.find(
        candidate => candidate.attemptId === association.attemptId,
      );
      if (!canonicalAttempt || canonicalAttempt.payment.bindingRef !== association.bindingRef) {
        retain(wake, "mismatch");
        continue;
      }
      const handoff = { result: "ok" as PaidOrderHandoffResult };
      const attempt = await reconcileCheckout(execution, association.cartId, wake.attemptId, r => { handoff.result = r; });
      if (attempt.phase !== "paid" && attempt.phase !== "released") {
        retain(wake, "unknown");
        continue;
      }
      if (!REGISTRY_BUILD && attempt.coupon && attempt.coupon.status !==
          (attempt.phase === "paid" ? "consumed" : "released")) {
        retain(wake, "unknown");
        continue;
      }
      if (attempt.phase === "paid") {
        if (!attempt.order || attempt.order.attemptId !== wake.attemptId || handoff.result === "conflict") {
          retain(wake, "mismatch");
          continue;
        }
        if (handoff.result !== "ok") {
          retain(wake, "unavailable");
          continue;
        }
      } else if (attempt.payment.total.minor !== "0") {
        if ((attempt.paymentMode ?? "test") !== (execution.paymentMode ?? "test")) {
          retain(wake, "mismatch");
          continue;
        }
        const payments = await execution.resolvePayments(attempt.payment.bindingRef);
        const o = payments ? (await payments.lookup(structuredClone(attempt.payment))).outcome : null;
        if (!o || o === "paid" || o === "unknown" || o === "open") {
          retain(wake, !o ? "unavailable" : o === "paid" ? "mismatch" : "unknown");
          continue;
        }
      }
      if (!await wakes.acknowledge(wake)) {
        retain(wake, "unavailable");
        continue;
      }
      results.push({ wake, status: "acknowledged", attempt });
    } catch {
      retain(wake, "unavailable");
    }
  }
  return results;
}

function isWake(value: unknown): value is CommercePaymentWake {
  if (!isRecord(value)) return false;
  const wake = value as Partial<CommercePaymentWake>;
  return typeof wake.eventId === "string" && wake.eventId.trim() !== "" &&
    typeof wake.attemptId === "string" && wake.attemptId.trim() !== "" &&
    typeof wake.bindingRef === "string" && wake.bindingRef.trim() !== "" &&
    typeof wake.deliveryGeneration === "number" &&
    Number.isSafeInteger(wake.deliveryGeneration) && wake.deliveryGeneration > 0 &&
    typeof wake.wokeAt === "number" && Number.isFinite(wake.wokeAt);
}
