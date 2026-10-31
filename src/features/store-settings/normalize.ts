import { isRecord } from "../../shared/record.js";
import {
  MAX_COUNTRIES,
  MAX_SETTINGS_BYTES,
  MERCHANT_STORE_SETTINGS_RECORD_KIND,
  StoreSettingsError,
  type CountryCode,
  type MerchantStoreSettings,
  type MerchantStoreSettingsInput,
} from "./types.js";

const COUNTRY = /^[A-Z]{2}$/;

// ISO 3166-1 alpha-2, kept as a compact set rather than a large UI option list:
// the codes run together and are read back two letters at a time.
// ISO 3166-1 alpha-2 as a 676-bit table (26 x 26 letters, base64): a code's bit is set when it is assigned.
// Half the bytes of the codes written out, which matters in the Registry backend.
const ISO_BITS = Uint8Array.from(atob("eFnf7u+93d4nP4QVgNQADgBcCbCf+xUAjQYYeA9AQAMAHSv0QYFP/fz/1yVLCAABQDyPUwEAAEAAUfH95zq7n5pBEARXhUAAAkAAAAAAEAAIBEAAAQ=="), (c) => c.charCodeAt(0));
const isoIndex = (code: string) => (code.charCodeAt(0) - 65) * 26 + code.charCodeAt(1) - 65;
const isoCountry = (code: string) => (ISO_BITS[isoIndex(code) >> 3]! & (1 << (isoIndex(code) & 7))) !== 0;

export const DEFAULT_SETTINGS: MerchantStoreSettings = Object.freeze({
  recordKind: MERCHANT_STORE_SETTINGS_RECORD_KIND,
  storeCountry: null,
  sellingCountries: Object.freeze([]),
  shippingCountries: Object.freeze([]),
  requirePhoneNumber: false,
});

function invalid(message: string): never {
  throw new StoreSettingsError("INVALID_INPUT", message);
}

function storageInvalid(message: string, cause?: unknown): never {
  throw new StoreSettingsError("STORAGE_UNAVAILABLE", message, 503, cause === undefined ? undefined : { cause });
}

function country(value: unknown, field: string): CountryCode {
  if (typeof value !== "string") invalid(`${field} must be an ISO 3166-1 alpha-2 country code`);
  const normalized = value.trim().toUpperCase();
  if (!COUNTRY.test(normalized) || !isoCountry(normalized)) invalid(`${field} is not a recognized country code`);
  return normalized;
}

function countries(value: unknown, field: string): readonly CountryCode[] {
  if (!Array.isArray(value) || value.length > MAX_COUNTRIES) invalid(`${field} must be a list of at most ${MAX_COUNTRIES} countries`);
  const result = [...new Set(value.map((entry) => country(entry, field)))];
  return Object.freeze(result);
}

function ensureSize(settings: MerchantStoreSettings): void {
  if (new TextEncoder().encode(JSON.stringify(settings)).byteLength > MAX_SETTINGS_BYTES) {
    invalid("merchant store settings payload is too large");
  }
}

export function normalizeStoredSettings(value: unknown): MerchantStoreSettings {
  if (!isRecord(value)) storageInvalid("stored merchant store settings are invalid");
  const record = value as Record<string, unknown>;
  if (record.recordKind !== MERCHANT_STORE_SETTINGS_RECORD_KIND) storageInvalid("stored merchant store settings are invalid");
  const expectedKeys = ["recordKind", "storeCountry", "sellingCountries", "shippingCountries", "requirePhoneNumber"];
  if (Object.keys(record).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(record, key))) {
    storageInvalid("stored merchant store settings have an invalid shape");
  }
  try {
    const storeCountry = record.storeCountry === null ? null : country(record.storeCountry, "storeCountry");
    const sellingCountries = countries(record.sellingCountries, "sellingCountries");
    const shippingCountries = countries(record.shippingCountries, "shippingCountries");
    if (storeCountry === null && (sellingCountries.length || shippingCountries.length)) storageInvalid("stored country lists require a store country");
    if (typeof record.requirePhoneNumber !== "boolean") storageInvalid("stored requirePhoneNumber is invalid");
    const settings = Object.freeze({
      recordKind: MERCHANT_STORE_SETTINGS_RECORD_KIND,
      storeCountry,
      sellingCountries,
      shippingCountries,
      requirePhoneNumber: record.requirePhoneNumber,
    });
    ensureSize(settings);
    return settings;
  } catch (error) {
    if (error instanceof StoreSettingsError && error.code === "STORAGE_UNAVAILABLE") throw error;
    storageInvalid("stored merchant store settings are invalid", error);
  }
}

export function normalizeSettingsInput(
  raw: MerchantStoreSettingsInput,
  current: MerchantStoreSettings,
): MerchantStoreSettings {
  if (!isRecord(raw)) invalid("settings input must be an object");
  const keys = Object.keys(raw as object);
  const allowed = new Set(["storeCountry", "sellingCountries", "shippingCountries", "requirePhoneNumber"]);
  if (keys.some((key) => !allowed.has(key))) invalid("settings input contains an unknown field");
  const input = raw as Record<string, unknown>;
  const hasCountry = Object.hasOwn(input, "storeCountry");
  const storeCountry = hasCountry ? country(input.storeCountry, "storeCountry") : current.storeCountry;
  if (storeCountry === null) {
    if (Object.hasOwn(input, "sellingCountries") || Object.hasOwn(input, "shippingCountries")) {
      invalid("storeCountry is required before country lists can be configured");
    }
  }
  const firstCountryConfiguration = current.storeCountry === null && storeCountry !== null;
  const sellingCountries = Object.hasOwn(input, "sellingCountries")
    ? countries(input.sellingCountries, "sellingCountries")
    : firstCountryConfiguration ? Object.freeze([storeCountry]) : current.sellingCountries;
  const shippingCountries = Object.hasOwn(input, "shippingCountries")
    ? countries(input.shippingCountries, "shippingCountries")
    : firstCountryConfiguration ? Object.freeze([storeCountry]) : current.shippingCountries;
  const requirePhoneNumber = Object.hasOwn(input, "requirePhoneNumber")
    ? input.requirePhoneNumber
    : current.requirePhoneNumber;
  if (typeof requirePhoneNumber !== "boolean") invalid("requirePhoneNumber must be boolean");
  const settings = Object.freeze({
    recordKind: MERCHANT_STORE_SETTINGS_RECORD_KIND,
    storeCountry,
    sellingCountries,
    shippingCountries,
    requirePhoneNumber,
  });
  ensureSize(settings);
  return settings;
}

export function countryCodes(): readonly string[] {
  return Array.from({ length: 676 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26)).filter(isoCountry);
}
