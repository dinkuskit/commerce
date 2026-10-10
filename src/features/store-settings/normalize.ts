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

// ISO 3166-1 alpha-2, kept as a compact set rather than a large UI option list.
const ISO_COUNTRIES = new Set(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" "));

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
  if (!COUNTRY.test(normalized) || !ISO_COUNTRIES.has(normalized)) invalid(`${field} is not a recognized country code`);
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
  return [...ISO_COUNTRIES].sort();
}
