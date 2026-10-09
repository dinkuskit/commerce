import {
  CheckoutContactError,
  type CheckoutContactErrorCode,
} from "./errors.js";
import {
  CHECKOUT_CONTACT_SNAPSHOT_SCHEMA,
  type CheckoutContactRequirements,
  type CheckoutContactRequirementsLoader,
  type CheckoutContactSnapshot,
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyContactKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => key === "email" || key === "phone");
}

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
  return phone === undefined ? { email } : { email, phone };
}

function validateRequirements(value: unknown): CheckoutContactRequirements {
  if (!isObject(value)) invalid("REQUIREMENTS_UNAVAILABLE");
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "requirePhoneNumber,revision" || typeof value.requirePhoneNumber !== "boolean") {
    invalid("REQUIREMENTS_UNAVAILABLE");
  }
  if (value.revision !== null && typeof value.revision !== "string") {
    invalid("REQUIREMENTS_UNAVAILABLE");
  }
  return {
    requirePhoneNumber: value.requirePhoneNumber,
    revision: value.revision,
  };
}

export async function captureCheckoutContact(
  raw: unknown,
  loadRequirements: CheckoutContactRequirementsLoader,
): Promise<CheckoutContactSnapshot> {
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

  const detachedContact: NormalizedCheckoutContact =
    contact.phone === undefined
      ? { email: `${contact.email}` }
      : { email: `${contact.email}`, phone: `${contact.phone}` };
  return Object.freeze({
    schema: CHECKOUT_CONTACT_SNAPSHOT_SCHEMA,
    contact: Object.freeze(detachedContact),
    requirePhoneNumber: requirements.requirePhoneNumber,
    revision: requirements.revision === null ? null : `${requirements.revision}`,
  });
}
