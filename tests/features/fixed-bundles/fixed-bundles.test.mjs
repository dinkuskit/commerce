import assert from "node:assert/strict";
import test from "node:test";

import {
  FixedBundleError,
  projectFixedBundleFulfillment,
} from "../../../dist/features/fixed-bundles/index.js";
import {
  COVER,
  TONGS,
  integrityProbe,
  memoryCatalog,
  starterKitDefinition,
} from "./fixture.mjs";

async function rejectsWithCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof FixedBundleError && error.code === code,
  );
}

function assertFulfillmentOnly(snapshot) {
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "components",
    "definitionId",
    "purchasedBundleQuantity",
  ]);
  for (const component of snapshot.components) {
    assert.deepEqual(Object.keys(component).sort(), [
      "catalogItemId",
      "name",
      "quantityPerBundle",
      "sku",
      "totalQuantity",
    ]);
    assert.equal("unitPrice" in component, false);
    assert.equal("stockManagement" in component, false);
    assert.equal("quantity" in component && component.quantity === undefined, false);
  }
}

test("projects product IDs, SKUs, names, and quantities from canonical catalog records", async () => {
  const catalog = memoryCatalog({
    [TONGS.itemId]: TONGS,
    [COVER.itemId]: COVER,
  });

  const snapshot = await projectFixedBundleFulfillment(
    starterKitDefinition(),
    catalog,
    1,
  );

  assert.deepEqual(snapshot, {
    definitionId: "def:starter-kit",
    purchasedBundleQuantity: 1,
    components: [
      {
        catalogItemId: "item-tongs",
        sku: "TONGS",
        name: "Grill Tongs",
        quantityPerBundle: 1,
        totalQuantity: 1,
      },
      {
        catalogItemId: "item-cover",
        sku: "COVER",
        name: "Grill Cover",
        quantityPerBundle: 2,
        totalQuantity: 2,
      },
    ],
  });
  assertFulfillmentOnly(snapshot);
});

test("scales component totals for multiple purchased bundle units", async () => {
  const catalog = memoryCatalog({
    [TONGS.itemId]: TONGS,
    [COVER.itemId]: COVER,
  });

  const snapshot = await projectFixedBundleFulfillment(
    starterKitDefinition(),
    catalog,
    3,
  );

  assert.equal(snapshot.purchasedBundleQuantity, 3);
  assert.deepEqual(
    snapshot.components.map((component) => component.totalQuantity),
    [3, 6],
  );
  assert.deepEqual(
    snapshot.components.map((component) => component.quantityPerBundle),
    [1, 2],
  );
});

test("preserves definition membership and order, including repeated component lines", async () => {
  const catalog = memoryCatalog({
    [TONGS.itemId]: TONGS,
    [COVER.itemId]: COVER,
  });
  const definition = {
    definitionId: "def:repeated-tongs",
    components: [
      { catalogItemId: COVER.itemId, quantityPerBundle: 1 },
      { catalogItemId: TONGS.itemId, quantityPerBundle: 2 },
      { catalogItemId: TONGS.itemId, quantityPerBundle: 1 },
    ],
  };

  const snapshot = await projectFixedBundleFulfillment(definition, catalog, 2);

  assert.deepEqual(
    snapshot.components.map((component) => [
      component.catalogItemId,
      component.quantityPerBundle,
      component.totalQuantity,
    ]),
    [
      ["item-cover", 1, 2],
      ["item-tongs", 2, 4],
      ["item-tongs", 1, 2],
    ],
  );
});

test("detached snapshot stays unchanged after catalog, definition, and JSON roundtrip", async () => {
  const catalog = memoryCatalog({
    [TONGS.itemId]: TONGS,
    [COVER.itemId]: COVER,
  });
  const definition = starterKitDefinition();

  const snapshot = await projectFixedBundleFulfillment(definition, catalog, 2);
  const encoded = JSON.stringify(snapshot);
  const revived = JSON.parse(encoded);

  definition.definitionId = "def:mutated";
  definition.components[0].quantityPerBundle = 99;
  definition.components.pop();
  catalog.records.set(TONGS.itemId, {
    ...TONGS,
    name: "Renamed Tongs",
    sku: "TONGS-X",
  });
  catalog.records.delete(COVER.itemId);

  assert.deepEqual(snapshot, revived);
  assert.deepEqual(snapshot.components[0], {
    catalogItemId: "item-tongs",
    sku: "TONGS",
    name: "Grill Tongs",
    quantityPerBundle: 1,
    totalQuantity: 2,
  });
  assert.equal(snapshot.definitionId, "def:starter-kit");
  assert.equal(snapshot.components.length, 2);
});

test("refuses empty or bad definitions", async () => {
  const catalog = memoryCatalog({ [TONGS.itemId]: TONGS });
  const validComponent = { catalogItemId: TONGS.itemId, quantityPerBundle: 1 };

  await rejectsWithCode(
    projectFixedBundleFulfillment(null, catalog, 1),
    "INVALID_DEFINITION",
  );
  await rejectsWithCode(
    projectFixedBundleFulfillment({ components: [validComponent] }, catalog, 1),
    "INVALID_DEFINITION",
  );
  await rejectsWithCode(
    projectFixedBundleFulfillment(
      { definitionId: "   ", components: [validComponent] },
      catalog,
      1,
    ),
    "INVALID_DEFINITION",
  );
  await rejectsWithCode(
    projectFixedBundleFulfillment({ definitionId: "def:empty", components: [] }, catalog, 1),
    "INVALID_DEFINITION",
  );
  await rejectsWithCode(
    projectFixedBundleFulfillment(
      { definitionId: "def:bad-component", components: [null] },
      catalog,
      1,
    ),
    "INVALID_DEFINITION",
  );
  await rejectsWithCode(
    projectFixedBundleFulfillment(
      { definitionId: "def:blank-id", components: [{ catalogItemId: "  ", quantityPerBundle: 1 }] },
      catalog,
      1,
    ),
    "INVALID_DEFINITION",
  );
});

test("refuses missing, mismatched, and internal catalog records", async () => {
  const missing = memoryCatalog({ [TONGS.itemId]: TONGS });
  await rejectsWithCode(
    projectFixedBundleFulfillment(
      {
        definitionId: "def:missing",
        components: [{ catalogItemId: COVER.itemId, quantityPerBundle: 1 }],
      },
      missing,
      1,
    ),
    "CATALOG_ITEM_NOT_FOUND",
  );

  const mismatched = memoryCatalog({
    [TONGS.itemId]: { ...TONGS, itemId: "item-other" },
  });
  await rejectsWithCode(
    projectFixedBundleFulfillment(
      {
        definitionId: "def:mismatch",
        components: [{ catalogItemId: TONGS.itemId, quantityPerBundle: 1 }],
      },
      mismatched,
      1,
    ),
    "CATALOG_RECORD_MISMATCH",
  );

  const probe = integrityProbe({ itemId: "item-internal" });
  const internal = memoryCatalog({ "item-internal": probe });
  await rejectsWithCode(
    projectFixedBundleFulfillment(
      {
        definitionId: "def:internal",
        components: [{ catalogItemId: "item-internal", quantityPerBundle: 1 }],
      },
      internal,
      1,
    ),
    "CATALOG_RECORD_MISMATCH",
  );
});

test("refuses nonpositive, unsafe, and overflowing quantities", async () => {
  const catalog = memoryCatalog({ [TONGS.itemId]: TONGS });
  const definition = {
    definitionId: "def:qty",
    components: [{ catalogItemId: TONGS.itemId, quantityPerBundle: 1 }],
  };

  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    await rejectsWithCode(
      projectFixedBundleFulfillment(definition, catalog, quantity),
      "INVALID_QUANTITY",
    );
    await rejectsWithCode(
      projectFixedBundleFulfillment(
        {
          definitionId: "def:qty",
          components: [{ catalogItemId: TONGS.itemId, quantityPerBundle: quantity }],
        },
        catalog,
        1,
      ),
      "INVALID_QUANTITY",
    );
  }

  await rejectsWithCode(
    projectFixedBundleFulfillment(
      {
        definitionId: "def:overflow",
        components: [
          { catalogItemId: TONGS.itemId, quantityPerBundle: Number.MAX_SAFE_INTEGER },
        ],
      },
      catalog,
      2,
    ),
    "QUANTITY_OVERFLOW",
  );
});

test("projection does not imply Inventory or price authority", async () => {
  const catalog = memoryCatalog({
    [TONGS.itemId]: {
      ...TONGS,
      stockManagement: { mode: "managed", status: "active", inventorySkuId: "sku-tongs" },
    },
    [COVER.itemId]: COVER,
  });
  catalog.prices = new Map([[TONGS.itemId, { regular: { currency: "USD", minor: "1200" } }]]);
  catalog.reserve = () => {
    throw new Error("inventory reserve must not run");
  };

  const snapshot = await projectFixedBundleFulfillment(
    starterKitDefinition(),
    catalog,
    2,
  );

  assertFulfillmentOnly(snapshot);
  assert.equal(JSON.stringify(snapshot).includes("1200"), false);
  assert.equal(JSON.stringify(snapshot).includes("sku-tongs"), false);
  assert.equal(JSON.stringify(snapshot).includes("managed"), false);
});
