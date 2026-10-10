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


function hasOnlyContactKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => key === "email" || key === "phone" || key === "delivery");
}

const ADDRESS_FIELD_MAX_LENGTH = 200;
const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "region", "postalCode", "country"];
const OPTIONAL_ADDRESS_FIELDS = new Set(["line2", "region"]);

function normalizeDelivery(value: unknown): CheckoutDeliveryAddress {
  if (!isObject(value) || !Object.keys(value).every((key) => ADDRESS_FIELDS.includes(key))) invalid("DELIVERY_INVALID");
  const address: Record<string, string> = {};
  for (const field of ADDRESS_FIELDS) {
    const raw = value[field];
    if (raw === undefined && OPTIONAL_ADDRESS_FIELDS.has(field)) continue;
    if (typeof raw !== "string" || CONTROL_CHARACTER.test(raw) || raw.length > ADDRESS_FIELD_MAX_LENGTH) invalid("DELIVERY_INVALID");
    const text = raw.trim();
    if (text) address[field] = `${text}`;
    else if (!OPTIONAL_ADDRESS_FIELDS.has(field)) invalid("DELIVERY_REQUIRED");
  }
  address.country = address.country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(address.country)) invalid("DELIVERY_INVALID");
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
  return { email, ...(phone === undefined ? {} : { phone }), ...(delivery ? { delivery } : {}) };
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
 * A digital-only basket keeps no address even when one was sent.
 */
export async function captureCheckoutContact(
  raw: unknown,
  loadRequirements: CheckoutContactRequirementsLoader,
  needsDelivery = false,
): Promise<CheckoutContactSnapshot> {
  // A digital-only basket is never asked for an address, so whatever was sent is dropped unread.
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
  }

  const detachedContact: NormalizedCheckoutContact = {
    email: `${contact.email}`,
    ...(contact.phone === undefined ? {} : { phone: `${contact.phone}` }),
    ...(needsDelivery ? { delivery: Object.freeze({ ...contact.delivery! }) } : {}),
  };
  return Object.freeze({
    schema: CHECKOUT_CONTACT_SNAPSHOT_SCHEMA,
    contact: Object.freeze(detachedContact),
    requirePhoneNumber: requirements.requirePhoneNumber,
    revision: requirements.revision === null ? null : `${requirements.revision}`,
  });
}
