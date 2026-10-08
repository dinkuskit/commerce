import type { PluginContext } from "emdash";

export const MERCHANT_STORE_SETTINGS_KEY = "merchantStoreSettings";
export const MERCHANT_STORE_SETTINGS_RECORD_KIND = "merchant-store-settings";
export const MAX_COUNTRIES = 249;
export const MAX_SETTINGS_BYTES = 16_384;

export type CountryCode = string;

export interface MerchantStoreSettings {
  recordKind: typeof MERCHANT_STORE_SETTINGS_RECORD_KIND;
  storeCountry: CountryCode | null;
  sellingCountries: readonly CountryCode[];
  shippingCountries: readonly CountryCode[];
  requirePhoneNumber: boolean;
}

export interface VersionedMerchantStoreSettings {
  settings: MerchantStoreSettings;
  revision: string | null;
}

export interface MerchantStoreSettingsInput {
  storeCountry?: unknown;
  sellingCountries?: unknown;
  shippingCountries?: unknown;
  requirePhoneNumber?: unknown;
}

export interface SaveMerchantStoreSettingsInput extends MerchantStoreSettingsInput {
  expectedRevision: unknown;
}

export type SettingsAccess = Pick<PluginContext["settings"], "getVersioned" | "compareAndSet">;

export class StoreSettingsError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "STORAGE_UNAVAILABLE"
    | "CONFLICT"
    | "UNAUTHORIZED";
  readonly status: number;

  constructor(
    code: StoreSettingsError["code"],
    message: string,
    status = code === "INVALID_INPUT" ? 400 : code === "CONFLICT" ? 409 : code === "UNAUTHORIZED" ? 403 : 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StoreSettingsError";
    this.code = code;
    this.status = status;
  }
}
