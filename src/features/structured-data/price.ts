import type { StructuredMoney } from "./types.js";

const MINOR = /^(0|[1-9][0-9]*)$/;

/**
 * Convert integer minor units to an exact decimal string for schema.org price.
 * USD uses two fraction digits. No floating-point rounding.
 */
export function formatMinorUnitsAsDecimal(money: StructuredMoney): string {
  if (money.currency !== "USD" || typeof money.minor !== "string" || !MINOR.test(money.minor)) {
    throw new Error("structured-data price requires USD integer minor units");
  }
  const value = BigInt(money.minor);
  const whole = value / 100n;
  const fraction = value % 100n;
  return `${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}
