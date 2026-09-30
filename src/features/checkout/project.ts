import {
  GUEST_CHECKOUT_PROJECTION_SCHEMA,
  type CheckoutAttempt,
  type GuestCheckoutLine,
  type GuestCheckoutProjection,
  type GuestCheckoutState,
} from "./types.js";

function linesOf(attempt: CheckoutAttempt | undefined): GuestCheckoutLine[] {
  return (attempt?.payment.lines ?? []).map((line) => ({
    catalogItemId: line.catalogItemId,
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));
}

function stateOf(attempt: CheckoutAttempt): GuestCheckoutState {
  if (attempt.phase === "paid" && attempt.order) return "paid";
  if (attempt.phase === "released") return "released-retry";
  if (attempt.phase === "releasing") return "recoverable-failure";
  if (attempt.phase === "reserving") return "recoverable-failure";
  if (attempt.phase === "paying" && !attempt.session) return "recoverable-failure";
  return "pending";
}

export function projectGuestCheckout(attempt: CheckoutAttempt | undefined): GuestCheckoutProjection {
  if (!attempt) {
    return {
      schema: GUEST_CHECKOUT_PROJECTION_SCHEMA,
      state: "recoverable-failure",
      attemptId: null,
      lines: [],
      total: null,
      redirectUrl: null,
      order: null,
      retryAfter: null,
      unavailable: { code: "CHECKOUT_NOT_FOUND", message: "Checkout not found" },
    };
  }
  const lines = linesOf(attempt);
  const paid = attempt.phase === "paid" && attempt.order
    ? {
        orderId: attempt.order.orderId,
        receiptId: attempt.order.receiptId,
        lines,
        total: attempt.order.total,
      }
    : null;
  return {
    schema: GUEST_CHECKOUT_PROJECTION_SCHEMA,
    state: stateOf(attempt),
    attemptId: attempt.attemptId,
    lines,
    total: attempt.payment.total,
    redirectUrl: paid ? null : attempt.session?.redirectUrl ?? null,
    order: paid,
    retryAfter: attempt.phase === "released" ? attempt.attemptId : null,
    unavailable: null,
  };
}
