import assert from "node:assert/strict";
import test from "node:test";
import { commerceAdmin } from "../../../dist/admin/index.js";
import { normalizeWeightOz, setCatalogItemWeight } from "../../../dist/features/catalog/index.js";

class MemoryCollection {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.itemId, structuredClone(record)]));
    this.revisions = new Map([...this.records.keys()].map((id) => [id, crypto.randomUUID()]));
    this.puts = [];
  }
  async get(id) { return this.records.has(id) ? structuredClone(this.records.get(id)) : null; }
  async getVersioned(id) {
    return this.records.has(id) ? { value: structuredClone(this.records.get(id)), revision: this.revisions.get(id) } : null;
  }
  async put(id, record) { this.records.set(id, structuredClone(record)); this.revisions.set(id, crypto.randomUUID()); this.puts.push(id); }
  async compareAndSet(id, expectedRevision, record) {
    if ((this.revisions.get(id) ?? null) !== expectedRevision) return { applied: false };
    await this.put(id, record);
    return { applied: true };
  }
  async query({ where, limit } = {}) {
    let items = [...this.records.entries()].map(([id, data]) => ({ id, data: structuredClone(data) }));
    if (where) items = items.filter(({ data }) => Object.entries(where).every(([key, value]) => data[key] === value));
    return { items: typeof limit === "number" ? items.slice(0, limit) : items, hasMore: false };
  }
}
const item = (itemId, overrides = {}) => ({
  recordKind: "catalog-item", itemId, commandId: "catalog:create:" + itemId, creationIntent: { manageStock: false },
  kind: "simple-product", name: "Bag " + itemId, sku: itemId.toUpperCase(), skuKey: itemId.toUpperCase(),
  stockManagement: { mode: "unmanaged" }, state: "draft", createdAt: "2026-10-10T00:00:00.000Z", ...overrides,
});
function context(records) {
  const catalog = new MemoryCollection(records);
  const storage = { catalog_items: catalog };
  for (const name of ["catalog_prices", "catalog_manual_availability", "managed_sku_claims", "storefront_out_of_stock_listing", "catalog_media", "storefront_placeholder_image"]) storage[name] = new MemoryCollection();
  return { catalog, ctx: { storage } };
}
const weightForm = (response) => response.blocks.find((block) => block.type === "form" && block.submit.action_id.startsWith("weight:"));

test("a weight is ounces above 0 and up to 2400 with at most 2 decimals; blank clears it", () => {
  assert.equal(normalizeWeightOz("12.5"), 12.5);
  assert.equal(normalizeWeightOz(" 8 "), 8);
  assert.equal(normalizeWeightOz("2400"), 2400);
  assert.equal(normalizeWeightOz("0.25"), 0.25);
  for (const blank of ["", "  ", null]) assert.equal(normalizeWeightOz(blank), null);
  for (const bad of ["0", "-1", "2400.01", "1.234", "abc", "1e3", "12 oz", {}]) {
    assert.throws(() => normalizeWeightOz(bad), (error) => error.code === "INVALID_INPUT" && /ounces/.test(error.message), String(bad));
  }
});

test("setting a weight changes only the weight, and clearing removes it", async () => {
  const catalog = new MemoryCollection([item("bag")]);
  const before = await catalog.get("bag");
  assert.equal(await setCatalogItemWeight(catalog, "bag", "12.5"), true);
  assert.deepEqual(await catalog.get("bag"), { ...before, weightOz: 12.5 });
  assert.equal(await setCatalogItemWeight(catalog, "bag", "12.50"), false);
  assert.equal(await setCatalogItemWeight(catalog, "bag", ""), true);
  assert.deepEqual(await catalog.get("bag"), before);
  await assert.rejects(setCatalogItemWeight(catalog, "missing", "1"), (error) => error.code === "CATALOG_ITEM_NOT_FOUND");
});

test("the owner saves a product's shipping weight from its Products page", async () => {
  const { catalog, ctx } = context([item("bag")]);
  const opened = await commerceAdmin({ input: { type: "block_action", action_id: "open", value: "bag" } }, ctx);
  const form = weightForm(opened);
  assert.deepEqual(form.fields.map((field) => [field.action_id, field.label, field.initial_value]), [["w:bag", "Weight (oz)", ""]]);
  const saved = await commerceAdmin({ input: { type: "form_submit", action_id: form.submit.action_id, values: { "w:bag": "12.5" } } }, ctx);
  assert.deepEqual(saved.toast, { type: "success", message: "Weight saved" });
  assert.equal(weightForm(saved).fields[0].initial_value, "12.5");
  assert.equal((await catalog.get("bag")).weightOz, 12.5);
});

test("a refused weight saves nothing and keeps what the owner typed", async () => {
  const { catalog, ctx } = context([item("bag", { weightOz: 4 })]);
  const refused = await commerceAdmin({ input: { type: "form_submit", action_id: "weight:bag", values: { "w:bag": "heavy" } } }, ctx);
  assert.equal(refused.toast.type, "error");
  assert.match(refused.toast.message, /ounces/);
  assert.equal(weightForm(refused).fields[0].initial_value, "heavy");
  assert.equal((await catalog.get("bag")).weightOz, 4);
  assert.equal(catalog.puts.length, 0);
});

test("a weight form cannot set another product's weight or a digital product's", async () => {
  const { catalog, ctx } = context([item("bag"), item("other"), item("ebook", { fulfillment: "digital" })]);
  for (const values of [{ "w:bag": "1", "w:other": "2" }, { "w:ebook": "1" }]) {
    const refused = await commerceAdmin({ input: { type: "form_submit", action_id: "weight:bag", values } }, ctx);
    assert.equal(refused.toast.type, "error");
  }
  assert.equal(catalog.puts.length, 0);
  const digital = await commerceAdmin({ input: { type: "block_action", action_id: "open", value: "ebook" } }, ctx);
  assert.equal(weightForm(digital), undefined);
});

test("each physical choice of a product with choices gets its own weight", async () => {
  const selections = (valueId) => [{ optionId: "size", valueId }];
  const variantProduct = { schema: "dinkuskit.commerce.product-variants/v1", productId: "shirt", revision: 1, defaultMemberId: "shirt",
    options: [{ optionId: "size", label: "Size", values: [{ valueId: "s", label: "Small" }, { valueId: "l", label: "Large" }, { valueId: "d", label: "Download" }] }],
    members: [{ catalogItemId: "shirt", selections: selections("s"), fulfillment: "physical" },
      { catalogItemId: "shirt-l", selections: selections("l"), fulfillment: "physical" },
      { catalogItemId: "shirt-d", selections: selections("d"), fulfillment: "digital" }] };
  const { catalog, ctx } = context([item("shirt", { variantProduct }),
    item("shirt-l", { variantProductId: "shirt", variantSelections: selections("l") }),
    item("shirt-d", { variantProductId: "shirt", variantSelections: selections("d"), fulfillment: "digital" })]);
  const opened = await commerceAdmin({ input: { type: "block_action", action_id: "open", value: "shirt" } }, ctx);
  const form = weightForm(opened);
  assert.deepEqual(form.fields.map((field) => [field.action_id, field.label]), [["w:shirt", "Weight (oz): Small"], ["w:shirt-l", "Weight (oz): Large"]]);
  // One bad weight refuses the whole form, so nothing is half saved.
  const refused = await commerceAdmin({ input: { type: "form_submit", action_id: form.submit.action_id, values: { "w:shirt": "6", "w:shirt-l": "0" } } }, ctx);
  assert.equal(refused.toast.type, "error");
  assert.equal(catalog.puts.length, 0);
  const saved = await commerceAdmin({ input: { type: "form_submit", action_id: form.submit.action_id, values: { "w:shirt": "6", "w:shirt-l": "7.5" } } }, ctx);
  assert.equal(saved.toast.message, "Weight saved");
  assert.deepEqual([(await catalog.get("shirt")).weightOz, (await catalog.get("shirt-l")).weightOz, (await catalog.get("shirt-d")).weightOz], [6, 7.5, undefined]);
});
