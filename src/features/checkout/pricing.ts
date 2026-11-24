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
 */
export async function composeCheckoutPricing(
  lines: readonly CheckoutLine[],
  execution: CheckoutExecution,
  shipsGoods = true,
  addons: readonly AddonAnswer[] = [],
): Promise<CheckoutPricingSnapshot> {
  const pricing = execution.pricing;
  if (!pricing) fail("Pricing composition is unavailable");
  // A checkout with nothing physical ships nothing: it pays no shipping, and the store's shipping
  // configuration is neither read nor needed (checkout-digital-only-no-shipping-20261031, issue 302).
  const config = shipsGoods ? await pricing.resolveShippingConfiguration() : NOT_SHIPPED;
  if (!config) fail("Pricing configuration unavailable");
  const pricingLines: CheckoutPricingLine[] = lines.map((line, index) => {
    const unit = normalizeMoney(line.unitPrice);
    const subtotal = parseMinorUnits(unit.minor) * BigInt(line.quantity);
    let off = 0n;
    for (const answer of addons) {
      const said = answer.lines[index];
      if (answer.lines.length !== lines.length || said.item !== line.catalogItemId || said.price !== unit.minor || said.qty !== line.quantity) {
        fail("Checkout contention; retry");
      }
      off += parseMinorUnits(said.off);
    }
    if (off > subtotal) fail("Invalid add-on answer");
    return {
      catalogItemId: line.catalogItemId, quantity: line.quantity, unitPrice: unit,
      lineSubtotal: usd(subtotal), discount: usd(off), netAmount: usd(subtotal - off),
    };
  });
  const sum = (key: "lineSubtotal" | "discount") => usd(pricingLines.reduce((total, line) => total + BigInt(line[key].minor), 0n));
  const merchandiseSubtotal = sum("lineSubtotal");
  const couponDiscount = sum("discount");
  const netMerchandise = usd(BigInt(merchandiseSubtotal.minor) - BigInt(couponDiscount.minor));
  const free = addons.some(answer => answer.ship);
  let charge = shippingCharge(config, BigInt(netMerchandise.minor));
  if (free) charge = usd(0n);
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
    finalTotal: usd(BigInt(netMerchandise.minor) + BigInt(charge.minor)),
    lines: Object.freeze(pricingLines),
  });
}
