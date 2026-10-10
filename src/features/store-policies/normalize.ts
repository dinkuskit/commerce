import { isRecord } from "../../shared/record.js";
import { normalizeMoney, type Money } from "../catalog/kernel/index.js";
import { StorePoliciesError } from "./errors.js";
import type {
  DayBounds,
  ReturnFees,
  ReturnMethod,
  ReturnPolicyCategory,
  StoreShippingCharge,
} from "./types.js";

const ISO_COUNTRY = /^[A-Z]{2}$/;
const RETURN_CATEGORIES = new Set<ReturnPolicyCategory>([
  "MerchantReturnFiniteReturnWindow",
  "MerchantReturnNotPermitted",
  "MerchantReturnUnlimitedWindow",
]);
const RETURN_METHODS = new Set<ReturnMethod>([
  "ReturnByMail",
  "ReturnInStore",
  "ReturnAtKiosk",
]);
const RETURN_FEES = new Set<ReturnFees>([
  "FreeReturn",
  "ReturnFeesCustomerResponsibility",
  "ReturnShippingFees",
]);

function plain(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new StorePoliciesError("INVALID_INPUT", "policy input must be an object");
  }
  return value as Record<string, unknown>;
}

function optionalUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 2048) {
    throw new StorePoliciesError("INVALID_INPUT", `${label} must be a URL string`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorePoliciesError("INVALID_INPUT", `${label} must be an absolute URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new StorePoliciesError("INVALID_INPUT", `${label} must be http(s)`);
  }
  return url.href;
}

function countries(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 250) {
    throw new StorePoliciesError("INVALID_INPUT", `${label} must be a non-empty country list`);
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !ISO_COUNTRY.test(entry)) {
      throw new StorePoliciesError(
        "INVALID_INPUT",
        `${label} entries must be ISO 3166-1 alpha-2 codes`,
      );
    }
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

function dayBounds(value: unknown, label: string): DayBounds | undefined {
  if (value === undefined || value === null) return undefined;
  const object = plain(value);
  if (
    Object.keys(object).length !== 2 ||
    typeof object.min !== "number" ||
    typeof object.max !== "number" ||
    !Number.isSafeInteger(object.min) ||
    !Number.isSafeInteger(object.max) ||
    object.min < 0 ||
    object.max < object.min ||
    object.max > 3650
  ) {
    throw new StorePoliciesError("INVALID_INPUT", `${label} must be { min, max } day integers`);
  }
  return { min: object.min, max: object.max };
}

export function normalizeShippingCharge(raw: unknown): StoreShippingCharge {
  const input = plain(raw);
  if (typeof input.configurationId !== "string" || !input.configurationId.trim() || input.configurationId.length > 1024) {
    throw new StorePoliciesError("INVALID_INPUT", "configurationId is required");
  }
  if (input.mode !== "free" && input.mode !== "flat") {
    throw new StorePoliciesError("INVALID_INPUT", "mode must be free or flat");
  }
  let amount: Money | undefined;
  if (input.mode === "flat") {
    try {
      amount = normalizeMoney(input.amount, "shipping.amount");
    } catch {
      throw new StorePoliciesError("INVALID_INPUT", "flat shipping requires a USD amount");
    }
  } else if (input.amount !== undefined) {
    try {
      amount = normalizeMoney(input.amount, "shipping.amount");
    } catch {
      throw new StorePoliciesError("INVALID_INPUT", "free shipping amount must be valid USD");
    }
    if (amount.minor !== "0") {
      throw new StorePoliciesError("INVALID_INPUT", "free shipping amount must be zero");
    }
  }
  return {
    configurationId: input.configurationId.trim(),
    mode: input.mode,
    ...(amount ? { amount } : {}),
  };
}

export function normalizeShippingPolicyInput(raw: unknown): {
  charge: StoreShippingCharge;
  shippingDestinationCountries?: readonly string[];
  handlingTimeDays?: DayBounds;
  transitTimeDays?: DayBounds;
  policyPageUrl?: string;
} {
  const input = plain(raw);
  const charge = normalizeShippingCharge(input);
  const shippingDestinationCountries = countries(
    input.shippingDestinationCountries,
    "shippingDestinationCountries",
  );
  const handlingTimeDays = dayBounds(input.handlingTimeDays, "handlingTimeDays");
  const transitTimeDays = dayBounds(input.transitTimeDays, "transitTimeDays");
  const policyPageUrl = optionalUrl(input.policyPageUrl, "policyPageUrl");
  return {
    charge,
    ...(shippingDestinationCountries ? { shippingDestinationCountries } : {}),
    ...(handlingTimeDays ? { handlingTimeDays } : {}),
    ...(transitTimeDays ? { transitTimeDays } : {}),
    ...(policyPageUrl ? { policyPageUrl } : {}),
  };
}

export function normalizeReturnPolicyInput(raw: unknown): {
  applicableCountry?: readonly string[];
  returnPolicyCategory?: ReturnPolicyCategory;
  merchantReturnDays?: number;
  returnMethod?: ReturnMethod;
  returnFees?: ReturnFees;
  policyPageUrl?: string;
} {
  const input = plain(raw);
  const out: {
    applicableCountry?: readonly string[];
    returnPolicyCategory?: ReturnPolicyCategory;
    merchantReturnDays?: number;
    returnMethod?: ReturnMethod;
    returnFees?: ReturnFees;
    policyPageUrl?: string;
  } = {};
  const applicable = countries(input.applicableCountry, "applicableCountry");
  if (applicable) out.applicableCountry = applicable;
  if (input.returnPolicyCategory !== undefined && input.returnPolicyCategory !== null) {
    if (
      typeof input.returnPolicyCategory !== "string" ||
      !RETURN_CATEGORIES.has(input.returnPolicyCategory as ReturnPolicyCategory)
    ) {
      throw new StorePoliciesError("INVALID_INPUT", "returnPolicyCategory is invalid");
    }
    out.returnPolicyCategory = input.returnPolicyCategory as ReturnPolicyCategory;
  }
  if (input.merchantReturnDays !== undefined && input.merchantReturnDays !== null) {
    if (
      typeof input.merchantReturnDays !== "number" ||
      !Number.isSafeInteger(input.merchantReturnDays) ||
      input.merchantReturnDays < 0 ||
      input.merchantReturnDays > 3650
    ) {
      throw new StorePoliciesError("INVALID_INPUT", "merchantReturnDays must be a day integer");
    }
    out.merchantReturnDays = input.merchantReturnDays;
  }
  if (input.returnMethod !== undefined && input.returnMethod !== null) {
    if (typeof input.returnMethod !== "string" || !RETURN_METHODS.has(input.returnMethod as ReturnMethod)) {
      throw new StorePoliciesError("INVALID_INPUT", "returnMethod is invalid");
    }
    out.returnMethod = input.returnMethod as ReturnMethod;
  }
  if (input.returnFees !== undefined && input.returnFees !== null) {
    if (typeof input.returnFees !== "string" || !RETURN_FEES.has(input.returnFees as ReturnFees)) {
      throw new StorePoliciesError("INVALID_INPUT", "returnFees is invalid");
    }
    out.returnFees = input.returnFees as ReturnFees;
  }
  const url = optionalUrl(input.policyPageUrl, "policyPageUrl");
  if (url) out.policyPageUrl = url;
  if (!Object.keys(out).length) {
    throw new StorePoliciesError(
      "INVALID_INPUT",
      "return policy requires at least one configured field",
    );
  }
  return out;
}
