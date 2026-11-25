import { normalizeMoney, parseMinorUnits, type Money } from "../catalog/kernel/index.js";
import type {
  AddonAnswer,
  CheckoutLine,
  CheckoutPricingLine,
  CheckoutPricingSnapshot,
  CheckoutExecution,
  TrustedShippingConfiguration,
} from "./types.js";
import { CHECKOUT_PRICING_SCHEMA } from "./types.js";

function fail(message: string): never {
  throw new Error(message);
}

/** An amount times a rate in millionths, to the cent, halves up. */
const cents = (amount: bigint, rate: bigint) => (amount * rate + 500_000n) / 1_000_000n;

/** The address a tax answer names: the delivery address, or billing for a checkout with nothing to ship, one field a line. */
export const taxAddress = (a?: { line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string }) =>
  a && [a.line1, a.line2, a.city, a.region, a.postalCode, a.country].join("\n");

function usd(minor: bigint): Money {
  return normalizeMoney({ currency: "USD", minor: minor.toString() });
}

function shippingCharge(config: TrustedShippingConfiguration, goods: bigint): Money {
  if (typeof config.configurationId !== "string" || !config.configurationId.trim() ||
      !Number.isSafeInteger(config.revision) || config.revision < 1) {
    fail("Invalid shipping configuration");
  }
  if (config.mode === "free") {
    if (config.amount !== undefined && parseMinorUnits(normalizeMoney(config.amount).minor) !== 0n) {
      fail("Free shipping configuration must be zero");
    }
    return { currency: "USD", minor: "0" };
  }
  if (config.mode !== "flat" || !config.amount) fail("Invalid shipping configuration");
  const amount = normalizeMoney(config.amount);
  if (amount.currency !== "USD" || parseMinorUnits(amount.minor) < 0n) {
    fail("Flat shipping must be non-negative USD");
  }
  // An amount the owner set at DinkusKit.com waives it (checkout-free-shipping-over-20261027).
  const over = config.freeOver && normalizeMoney(config.freeOver);
  if (over && (over.currency !== "USD" || parseMinorUnits(over.minor) < 1n)) fail("Invalid shipping configuration");
  return over && goods >= BigInt(over.minor) ? usd(0n) : amount;
}

/**
 * What a checkout with nothing to ship records as its shipping: free, under an id no store's
 * configuration uses, so the frozen pricing keeps its shape for Payments.
 */
const NOT_SHIPPED: TrustedShippingConfiguration = { configurationId: "not-shipped", revision: 1, mode: "free" };

/**
 * Prices the frozen lines with the add-ons' answers (commerce-addons-door-20261124). Each answer names every line with
 * the item, unit price and quantity it saw: a different one means the cart or catalog changed since the store asked,
 * so the store asks again (an amount off worked out for ten mugs never lands on one). Amounts off are whole cents and never take a line below zero.
 * Tax comes after discounts (dinkuskit/tax ledger shared-addons-door): a tax answer must have priced `to`, the checkout's
 * own address, and each line's tax is its net amount times its rate, rounded to the cent once, halves up (round-per-line-half-up).
 */
export async function composeCheckoutPricing(
  lines: readonly CheckoutLine[],
  execution: CheckoutExecution,
  shipsGoods = true,
  addons: readonly AddonAnswer[] = [],
  to?: string,
): Promise<CheckoutPricingSnapshot> {
  const pricing = execution.pricing;
  if (!pricing) fail("Pricing composition is unavailable");
  // A checkout with nothing physical ships nothing: it pays no shipping, and the store's shipping
  // configuration is neither read nor needed (checkout-digital-only-no-shipping-20261031, issue 302).
  const config = shipsGoods ? await pricing.resolveShippingConfiguration() : NOT_SHIPPED;
  if (!config) fail("Pricing configuration unavailable");
  const taxed = addons.some(answer => answer.to !== undefined);
  const pricingLines: CheckoutPricingLine[] = lines.map((line, index) => {
    const unit = normalizeMoney(line.unitPrice);
    const subtotal = parseMinorUnits(unit.minor) * BigInt(line.quantity);
    let off = 0n, rate = 0n;
    for (const answer of addons) {
      const said = answer.lines[index];
      if (answer.lines.length !== lines.length || said.item !== line.catalogItemId || said.price !== unit.minor || said.qty !== line.quantity ||
        answer.to !== undefined && answer.to !== to) {
        fail("Checkout contention; retry");
      }
      off += parseMinorUnits(said.off);
      rate += BigInt(said.rate ?? 0);
    }
    if (off > subtotal) fail("Invalid add-on answer");
    return {
      catalogItemId: line.catalogItemId, quantity: line.quantity, unitPrice: unit,
      lineSubtotal: usd(subtotal), discount: usd(off), netAmount: usd(subtotal - off),
      ...(taxed ? { tax: usd(cents(subtotal - off, rate)) } : {}),
    };
  });
  const sum = (key: "lineSubtotal" | "discount") => usd(pricingLines.reduce((total, line) => total + BigInt(line[key].minor), 0n));
  const merchandiseSubtotal = sum("lineSubtotal");
  const couponDiscount = sum("discount");
  const netMerchandise = usd(BigInt(merchandiseSubtotal.minor) - BigInt(couponDiscount.minor));
  const free = addons.some(answer => answer.ship);
  let charge = shippingCharge(config, BigInt(netMerchandise.minor));
  if (free) charge = usd(0n);
  const tax = pricingLines.reduce((total, line) => total + BigInt(line.tax?.minor ?? 0),
    cents(BigInt(charge.minor), addons.reduce((total, answer) => total + BigInt(answer.shipRate ?? 0), 0n)));
  return Object.freeze({
    schema: CHECKOUT_PRICING_SCHEMA,
    merchandiseSubtotal,
    couponDiscount,
    netMerchandise,
    shipping: {
      configurationId: config.configurationId.trim(),
      revision: config.revision,
      mode: free || config.freeOver && charge.minor === "0" ? "free" : config.mode,
      charge,
    },
    ...(taxed ? { tax: usd(tax) } : {}),
    finalTotal: usd(BigInt(netMerchandise.minor) + BigInt(charge.minor) + tax),
    lines: Object.freeze(pricingLines),
  });
}
