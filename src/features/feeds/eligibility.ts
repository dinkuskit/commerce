import {
  PRODUCT_FEED_CHANNELS,
  type ProductFeedChannel,
  type ProductFeedEligibilityCatalog,
  type ProductFeedEligibilityRecord,
  type ProductFeedEligibilityStorage,
  type SetProductFeedEligibilityInput,
} from "./types.js";

function isChannel(value: unknown): value is ProductFeedChannel {
  return (PRODUCT_FEED_CHANNELS as readonly string[]).includes(value as string);
}

export function normalizeProductFeedChannels(value: unknown): ProductFeedChannel[] {
  if (!Array.isArray(value)) throw new TypeError("channels must be an array");
  const channels = [...new Set(value)];
  if (!channels.every(isChannel)) throw new TypeError("unsupported product feed channel");
  return channels.sort() as ProductFeedChannel[];
}

export async function loadProductFeedEligibility(
  storage: Pick<ProductFeedEligibilityStorage, "get">,
  catalogItemId: string,
): Promise<readonly ProductFeedChannel[]> {
  const record = await storage.get(catalogItemId);
  return record?.recordKind === "product-feed-eligibility"
    ? normalizeProductFeedChannels(record.channels)
    : [];
}

export async function setProductFeedEligibility(
  storage: ProductFeedEligibilityStorage,
  catalog: ProductFeedEligibilityCatalog,
  input: SetProductFeedEligibilityInput,
): Promise<ProductFeedEligibilityRecord> {
  if (!input.catalogItemId || (await catalog.get(input.catalogItemId)) === null) {
    throw new Error("catalog item was not found");
  }
  const record: ProductFeedEligibilityRecord = {
    recordKind: "product-feed-eligibility",
    recordId: input.catalogItemId,
    catalogItemId: input.catalogItemId,
    channels: normalizeProductFeedChannels(input.channels),
  };
  await storage.put(record.recordId, record);
  return record;
}
