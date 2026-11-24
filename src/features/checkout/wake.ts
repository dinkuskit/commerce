import { isRecord } from "../../shared/record.js";
import { reconcileCheckout } from "./orchestrate.js";
import type { WakeProbe } from "./orchestrate.js";
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
    let association;
    try {
      association = isWake(wake) ? await associations.get(wake.attemptId) : undefined;
    } catch {
      retain(wake, "unavailable");
      continue;
    }
    if (!association || association.attemptId !== wake.attemptId || association.bindingRef !== wake.bindingRef) {
      retain(wake, !isWake(wake) ? "unknown" : association ? "mismatch" : "missing");
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
      // A wake may be the late payment for a checkout that ended unpaid: that makes the order (commerce-late-payment-makes-order-20261123).
      const probe: WakeProbe = { handoff: "stored" };
      const attempt = await reconcileCheckout(execution, association.cartId, wake.attemptId, probe);
      const paid = attempt.phase === "paid";
      // Not settled yet, or a checkout that ended unpaid that Payments has not answered unpaid again; then a paid
      // order that is not this wake's or that Orders refused; then Orders or the ack unreachable.
      const reason = !paid && attempt.phase !== "released" ||
        !paid && attempt.paymentReleaseReason === "expired-unpaid" && !probe.unpaid ? "unknown"
        : paid && (!attempt.order || attempt.order.attemptId !== wake.attemptId || probe.handoff === "conflict") ? "mismatch"
        : probe.handoff === "unavailable" || !await wakes.acknowledge(wake) ? "unavailable" : null;
      if (reason) retain(wake, reason);
      else results.push({ wake, status: "acknowledged", attempt });
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
