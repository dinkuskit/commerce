export function catalogItem(overrides = {}) {
  return {
    recordKind: "catalog-item",
    itemId: "item-grill-42",
    commandId: "cmd:grill-42",
    creationIntent: { manageStock: false },
    kind: "simple-product",
    name: "Grill 42",
    sku: "GRILL-42",
    skuKey: "GRILL-42",
    stockManagement: { mode: "unmanaged" },
    state: "draft",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

export function integrityProbe(overrides = {}) {
  return {
    recordKind: "integrity-probe",
    itemId: "__dinkus_catalog_skuKey_probe",
    commandId: "__DINKUS_CATALOG_INTEGRITY_PROBE__command",
    kind: "integrity-probe",
    name: "DinkusKit catalog storage integrity probe",
    sku: "__DINKUS_CATALOG_INTEGRITY_PROBE__SKU",
    skuKey: "__DINKUS_CATALOG_INTEGRITY_PROBE__SKU",
    state: "internal",
    createdAt: "1970-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export const TONGS = catalogItem({
  itemId: "item-tongs",
  commandId: "cmd:tongs",
  name: "Grill Tongs",
  sku: "TONGS",
  skuKey: "TONGS",
});

export const COVER = catalogItem({
  itemId: "item-cover",
  commandId: "cmd:cover",
  name: "Grill Cover",
  sku: "COVER",
  skuKey: "COVER",
});

export function memoryCatalog(records) {
  const store = new Map(
    Object.entries(records).map(([id, record]) => [id, structuredClone(record)]),
  );
  return {
    records: store,
    async get(id) {
      const record = store.get(id);
      return record === undefined ? null : structuredClone(record);
    },
  };
}

export function starterKitDefinition(overrides = {}) {
  return {
    definitionId: "def:starter-kit",
    components: [
      { catalogItemId: TONGS.itemId, quantityPerBundle: 1 },
      { catalogItemId: COVER.itemId, quantityPerBundle: 2 },
    ],
    ...overrides,
  };
}
