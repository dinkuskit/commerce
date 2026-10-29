import { canonical, isRecord as isObject, sortedKeys } from "../../shared/record.js";
import {
  CheckoutContactError,
  type CheckoutContactErrorCode,
} from "./errors.js";
import {
  CHECKOUT_CONTACT_SNAPSHOT_SCHEMA,
  type CheckoutContactRequirements,
  type CheckoutContactRequirementsLoader,
  type CheckoutContactSnapshot,
  type CheckoutDeliveryAddress,
  type NormalizedCheckoutContact,
} from "./types.js";

export * from "./errors.js";
export * from "./types.js";

const EMAIL_MAX_LENGTH = 254;
const EMAIL_LOCAL_MAX_LENGTH = 64;
const PHONE_MAX_LENGTH = 64;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
// Ordinary ASCII dot-atom mailbox and DNS labels; this is syntax, never ownership.
const EMAIL_SYNTAX = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function invalid(code: CheckoutContactErrorCode): never {
  throw new CheckoutContactError(code);
}


const CONTACT_KEYS = ["email", "phone", "delivery", "billing"] as const;

function hasOnlyContactKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => CONTACT_KEYS.includes(key as never));
}

const ADDRESS_FIELD_MAX_LENGTH = 200;
const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "region", "postalCode", "country"];
const OPTIONAL_ADDRESS_FIELDS = new Set(["line2", "region"]);

// Eligibility belongs to new physical capture, not shared address normalization.
const US_DELIVERY_REGIONS = new Set((
  "AL|ALABAMA|AK|ALASKA|AZ|ARIZONA|AR|ARKANSAS|CA|CALIFORNIA|CO|COLORADO|CT|CONNECTICUT|DE|DELAWARE|" +
  "FL|FLORIDA|GA|GEORGIA|HI|HAWAII|ID|IDAHO|IL|ILLINOIS|IN|INDIANA|IA|IOWA|KS|KANSAS|KY|KENTUCKY|" +
  "LA|LOUISIANA|ME|MAINE|MD|MARYLAND|MA|MASSACHUSETTS|MI|MICHIGAN|MN|MINNESOTA|MS|MISSISSIPPI|" +
  "MO|MISSOURI|MT|MONTANA|NE|NEBRASKA|NV|NEVADA|NH|NEW HAMPSHIRE|NJ|NEW JERSEY|NM|NEW MEXICO|" +
  "NY|NEW YORK|NC|NORTH CAROLINA|ND|NORTH DAKOTA|OH|OHIO|OK|OKLAHOMA|OR|OREGON|PA|PENNSYLVANIA|" +
  "RI|RHODE ISLAND|SC|SOUTH CAROLINA|SD|SOUTH DAKOTA|TN|TENNESSEE|TX|TEXAS|UT|UTAH|VT|VERMONT|" +
  "VA|VIRGINIA|WA|WASHINGTON|WV|WEST VIRGINIA|WI|WISCONSIN|WY|WYOMING|DC|DISTRICT OF COLUMBIA"
).split("|"));

function isEligibleUsRegion(region: string | undefined): boolean {
  return US_DELIVERY_REGIONS.has(region?.trim().toUpperCase() ?? "");
}

/** Delivery and billing addresses share one shape and one check; only the refusal names which one. */
function normalizeDelivery(value: unknown, billing?: boolean): CheckoutDeliveryAddress {
  const bad = billing ? "BILLING_INVALID" : "DELIVERY_INVALID";
  if (!isObject(value) || !Object.keys(value).every((key) => ADDRESS_FIELDS.includes(key))) invalid(bad);
  const address: Record<string, string> = {};
  for (const field of ADDRESS_FIELDS) {
    const raw = value[field];
    if (raw === undefined && OPTIONAL_ADDRESS_FIELDS.has(field)) continue;
    if (typeof raw !== "string" || CONTROL_CHARACTER.test(raw) || raw.length > ADDRESS_FIELD_MAX_LENGTH) invalid(bad);
    const text = raw.trim();
    if (text) address[field] = `${text}`;
    else if (!OPTIONAL_ADDRESS_FIELDS.has(field)) invalid(billing ? bad : "DELIVERY_REQUIRED");
  }
  address.country = address.country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(address.country)) invalid(bad);
  return address as unknown as CheckoutDeliveryAddress;
}

/** A delivery address checked exactly as checkout checks one; throws CheckoutContactError. */
export const normalizeCheckoutDelivery = normalizeDelivery;

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") invalid("EMAIL_REQUIRED");
  if (CONTROL_CHARACTER.test(value)) invalid("EMAIL_INVALID");
  const email = value.trim();
  if (
    email.length === 0 ||
    email.length > EMAIL_MAX_LENGTH ||
    !EMAIL_SYNTAX.test(email)
  ) {
    invalid(email.length === 0 ? "EMAIL_REQUIRED" : "EMAIL_INVALID");
  }
  const at = email.lastIndexOf("@");
  if (at <= 0 || at > EMAIL_LOCAL_MAX_LENGTH || at === email.length - 1) {
    invalid("EMAIL_INVALID");
  }
  return `${email}`;
}

function normalizePhone(value: unknown): string | undefined {
  if (value === undefined || value === null) invalid("INVALID_INPUT");
  if (typeof value !== "string") invalid("INVALID_INPUT");
  if (CONTROL_CHARACTER.test(value)) invalid("INVALID_INPUT");
  const phone = value.trim();
  if (phone.length === 0) return undefined;
  if (phone.length > PHONE_MAX_LENGTH) {
    invalid("INVALID_INPUT");
  }
  return `${phone}`;
}

export function normalizeCheckoutContactInput(raw: unknown): NormalizedCheckoutContact {
  if (!isObject(raw) || !hasOnlyContactKeys(raw) || !Object.hasOwn(raw, "email")) {
    invalid("INVALID_INPUT");
  }

  const email = normalizeEmail(raw.email);
  const phone = Object.hasOwn(raw, "phone") ? normalizePhone(raw.phone) : undefined;
  const delivery = Object.hasOwn(raw, "delivery") ? normalizeDelivery(raw.delivery) : undefined;
  const billing = Object.hasOwn(raw, "billing") ? normalizeDelivery(raw.billing, true) : undefined;
  return { email, ...(phone === undefined ? {} : { phone }), ...(delivery ? { delivery } : {}), ...(billing ? { billing } : {}) };
}

/**
 * True only for a snapshot exactly as checkout freezes it: the v1 fields and a
 * contact that Checkout's own rules leave unchanged. Receivers that keep a copy
 * for good use this so they never hold contact data Checkout would refuse.
 */
export function isCheckoutContactSnapshot(value: unknown): boolean {
  if (!isObject(value) || sortedKeys(value) !== "contact,requirePhoneNumber,revision,schema" ||
      value.schema !== CHECKOUT_CONTACT_SNAPSHOT_SCHEMA || typeof value.requirePhoneNumber !== "boolean" ||
      (value.revision !== null && typeof value.revision !== "string")) return false;
  try {
    return canonical(normalizeCheckoutContactInput(value.contact)) === canonical(value.contact);
  } catch {
    return false;
  }
}

function validateRequirements(value: unknown): CheckoutContactRequirements {
  if (!isObject(value)) invalid("REQUIREMENTS_UNAVAILABLE");
  const keys = sortedKeys(value);
  if (keys !== "requirePhoneNumber,revision,shippingCountries" || typeof value.requirePhoneNumber !== "boolean" ||
      !Array.isArray(value.shippingCountries) || !value.shippingCountries.every((c) => typeof c === "string")) {
    invalid("REQUIREMENTS_UNAVAILABLE");
  }
  if (value.revision !== null && typeof value.revision !== "string") {
    invalid("REQUIREMENTS_UNAVAILABLE");
  }
  return {
    requirePhoneNumber: value.requirePhoneNumber,
    shippingCountries: [...value.shippingCountries],
    revision: value.revision,
  };
}

/**
 * Freezes the shopper's contact. `needsDelivery` is true when the basket holds a
 * physical item: the address is then required and must go to a shipping country.
 * A digital-only basket keeps no delivery address even when one was sent.
 * Every checkout keeps a billing address (commerce-billing-address-001).
 */
export async function captureCheckoutContact(
  raw: unknown,
  loadRequirements: CheckoutContactRequirementsLoader,
  needsDelivery = false,
): Promise<CheckoutContactSnapshot> {
  // A digital-only basket is never asked for a delivery address, so whatever was sent is dropped unread.
  if (!needsDelivery && isObject(raw) && Object.hasOwn(raw, "delivery")) {
    const { delivery: _ignored, ...rest } = raw;
    raw = rest;
  }
  const contact = normalizeCheckoutContactInput(raw);
  let requirements: CheckoutContactRequirements;
  try {
    requirements = validateRequirements(await loadRequirements());
  } catch (error) {
    if (error instanceof CheckoutContactError && error.code === "REQUIREMENTS_UNAVAILABLE") {
      throw error;
    }
    throw new CheckoutContactError("REQUIREMENTS_UNAVAILABLE");
  }

  if (requirements.requirePhoneNumber && contact.phone === undefined) {
    invalid("PHONE_REQUIRED");
  }
  if (needsDelivery) {
    if (!contact.delivery) invalid("DELIVERY_REQUIRED");
    if (!requirements.shippingCountries.includes(contact.delivery.country)) invalid("DELIVERY_COUNTRY_UNAVAILABLE");
    if (contact.delivery.country === "US" && !isEligibleUsRegion(contact.delivery.region)) invalid("DELIVERY_INVALID");
  }
  // Every checkout carries a billing address, in any country; the storefront sends a copy when it equals delivery.
  if (!contact.billing) invalid("BILLING_INVALID");

  return freezeCheckoutContactSnapshot({
    schema: CHECKOUT_CONTACT_SNAPSHOT_SCHEMA,
    contact,
    requirePhoneNumber: requirements.requirePhoneNumber,
    revision: requirements.revision,
  });
}

/** A frozen copy detached from its source, keeping only the v1 snapshot fields. */
export function freezeCheckoutContactSnapshot(snapshot: CheckoutContactSnapshot): CheckoutContactSnapshot {
  const contact: Record<string, unknown> = {};
  for (const key of CONTACT_KEYS) {
    const value = snapshot.contact[key];
    if (value !== undefined) contact[key] = typeof value === "string" ? `${value}` : Object.freeze({ ...value });
  }
  return Object.freeze({
    schema: snapshot.schema,
    contact: Object.freeze(contact) as unknown as NormalizedCheckoutContact,
    requirePhoneNumber: snapshot.requirePhoneNumber,
    revision: snapshot.revision === null ? null : `${snapshot.revision}`,
  });
}
