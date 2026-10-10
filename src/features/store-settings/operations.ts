import { isRecord } from "../../shared/record.js";
import type { PluginContext } from "emdash";

import { DEFAULT_SETTINGS, normalizeSettingsInput, normalizeStoredSettings } from "./normalize.js";
import {
  MERCHANT_STORE_SETTINGS_KEY,
  StoreSettingsError,
  type MerchantStoreSettings,
  type SaveMerchantStoreSettingsInput,
  type SettingsAccess,
  type VersionedMerchantStoreSettings,
} from "./types.js";

function storageError(message: string, cause: unknown): StoreSettingsError {
  return new StoreSettingsError("STORAGE_UNAVAILABLE", message, 503, { cause });
}

export async function loadMerchantStoreSettings(
  settings: Pick<PluginContext["settings"], "getVersioned">,
): Promise<VersionedMerchantStoreSettings> {
  let stored;
  try {
    stored = await settings.getVersioned<unknown>(MERCHANT_STORE_SETTINGS_KEY);
  } catch (error) {
    throw storageError("merchant store settings could not be read", error);
  }
  if (stored === null) return { settings: DEFAULT_SETTINGS, revision: null };
  try {
    if (typeof stored.revision !== "string" || stored.revision.length === 0) {
      throw new Error("invalid opaque settings revision");
    }
    return { settings: normalizeStoredSettings(stored.value), revision: stored.revision };
  } catch (error) {
    if (error instanceof StoreSettingsError) throw error;
    throw storageError("stored merchant store settings are invalid", error);
  }
}

export async function saveMerchantStoreSettings(
  settings: SettingsAccess,
  raw: SaveMerchantStoreSettingsInput,
): Promise<VersionedMerchantStoreSettings> {
  if (!isRecord(raw)) {
    throw new StoreSettingsError("INVALID_INPUT", "settings input must be an object");
  }
  if (typeof raw.expectedRevision !== "string" && raw.expectedRevision !== null) {
    throw new StoreSettingsError("INVALID_INPUT", "expectedRevision must be an opaque string or null");
  }
  const current = await loadMerchantStoreSettings(settings);
  if (current.revision !== raw.expectedRevision) {
    throw new StoreSettingsError("CONFLICT", "settings changed elsewhere; reload before retrying");
  }
  const { expectedRevision: _expectedRevision, ...settingsInput } = raw;
  const next = normalizeSettingsInput(settingsInput, current.settings);
  let result;
  try {
    result = await settings.compareAndSet(MERCHANT_STORE_SETTINGS_KEY, raw.expectedRevision, next);
  } catch (error) {
    throw storageError("merchant store settings could not be saved", error);
  }
  if (!result.applied) throw new StoreSettingsError("CONFLICT", "settings changed elsewhere; reload before retrying");
  return { settings: next, revision: result.revision ?? null };
}

export async function loadCheckoutContactRequirements(
  settings: Pick<PluginContext["settings"], "getVersioned">,
): Promise<{ requirePhoneNumber: boolean; revision: string | null }> {
  const current = await loadMerchantStoreSettings(settings);
  return { requirePhoneNumber: current.settings.requirePhoneNumber, revision: current.revision };
}

export type { MerchantStoreSettings };
