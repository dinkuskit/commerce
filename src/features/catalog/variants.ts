import { catalogItemState } from "./product-state.js";
import { isRecord } from "../../shared/record.js";
import { catalogFail } from "./errors.js";
import { createCatalogItem } from "./create-catalog-item.js";
import type {
  CatalogFulfillment, CatalogItemRecord, CatalogStorageRecord, CatalogVariantMember,
  CatalogVariantOption, CatalogVariantOptionValue, CatalogVariantProduct, CatalogVariantSelection,
} from "./types.js";

export type { CatalogVariantMember, CatalogVariantOption, CatalogVariantOptionValue, CatalogVariantProduct } from "./types.js";
export interface CatalogVariantStorage { catalog: {
  get(id: string): Promise<CatalogStorageRecord | null>;
  getVersioned(id: string): Promise<{ value: CatalogStorageRecord; revision: string } | null>;
  compareAndSet(id: string, revision: string, value: CatalogStorageRecord): Promise<{ applied: boolean }>;
} }
export interface VariantSelectionInput { optionId: string; valueId: string; label?: string }
export interface VariantMemberInput {
  catalogItemId?: string; commandId?: string; name?: string; sku?: string;
  fulfillment?: CatalogFulfillment; valueId?: string;
  selections?: readonly VariantSelectionInput[];
}
export interface AddCatalogVariantMemberInput {
  productId: string; expectedRevision: number;
  commandId: string; name: string; sku: string; fulfillment: CatalogFulfillment;
  selections: readonly VariantSelectionInput[];
}
export interface AddCatalogVariantOptionInput {
  productId: string; expectedRevision?: number; optionId: string; optionLabel: string;
  values: readonly { valueId: string; label: string; member?: VariantMemberInput; members?: readonly VariantMemberInput[] }[];
  members?: readonly VariantMemberInput[];
}
export interface UpdateCatalogVariantLabelsInput {
  productId: string; expectedRevision: number; optionId?: string; optionLabel?: string;
  options?: readonly { optionId: string; label: string }[];
  values?: readonly { optionId?: string; valueId: string; label: string }[];
  members?: readonly { catalogItemId: string; fulfillment: CatalogFulfillment }[];
}
/** parent is the product record a choice belongs to; its name and archive state speak for every choice. */
export interface CatalogVariantResolution { item: CatalogItemRecord; product: CatalogVariantProduct | null; member: CatalogVariantMember | null; parent?: CatalogItemRecord }

const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/;
const id = (v: unknown, field: string) => {
  if (typeof v !== "string" || !ID.test(v)) catalogFail("INVALID_INPUT", `invalid ${field}`);
  return v;
};
const text = (v: unknown, field: string) => {
  if (typeof v !== "string" || !v.trim() || v.length > 160) catalogFail("INVALID_INPUT", `${field} must be a non-empty string`);
  return v.normalize("NFKC").trim();
};
const fill = (v: unknown): CatalogFulfillment => {
  if (v !== "physical" && v !== "digital") catalogFail("INVALID_INPUT", "fulfillment must be physical or digital");
  return v;
};
const key = (s: readonly CatalogVariantSelection[]) =>
  JSON.stringify([...s].sort((a, b) => `${a.optionId}:${a.valueId}`.localeCompare(`${b.optionId}:${b.valueId}`)));
const same = (a: readonly CatalogVariantSelection[], b: readonly CatalogVariantSelection[]) => key(a) === key(b);
const payload = (v: unknown) => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);

function valid(raw: unknown, productId: string): CatalogVariantProduct {
  const p = raw as CatalogVariantProduct;
  if (!p || typeof p !== "object" || p.schema !== "dinkuskit.commerce.product-variants/v1" ||
      p.productId !== productId || !Number.isSafeInteger(p.revision) || p.revision < 0 ||
      !Array.isArray(p.options) || p.options.length > 3 || !Array.isArray(p.members) ||
      p.members.length < 1 || p.members.length > 50 || (p.options.length > 0 && p.members.length < 2) || !ID.test(p.defaultMemberId)) {
    catalogFail("STORAGE_UNAVAILABLE", "stored variant product is invalid");
  }
  const options = new Set<string>();
  for (const o of p.options) {
    if (!o || !ID.test(o.optionId) || options.has(o.optionId) || !o.label || !Array.isArray(o.values) || o.values.length < 2 || o.values.length > 50)
      catalogFail("STORAGE_UNAVAILABLE", "stored variant options are invalid");
    options.add(o.optionId);
    const values = new Set<string>();
    for (const v of o.values) {
      if (!v || !ID.test(v.valueId) || !v.label || values.has(v.valueId))
        catalogFail("STORAGE_UNAVAILABLE", "stored variant values are invalid");
      values.add(v.valueId);
    }
  }
  const members = new Set<string>(), combinations = new Set<string>();
  for (const m of p.members) {
    if (!m || !ID.test(m.catalogItemId) || members.has(m.catalogItemId) || !Array.isArray(m.selections) ||
        !["physical", "digital"].includes(m.fulfillment)) catalogFail("STORAGE_UNAVAILABLE", "stored variant members are invalid");
    members.add(m.catalogItemId);
    const selected = new Set<string>();
    for (const s of m.selections) {
      const o = p.options.find(x => x.optionId === s.optionId);
      if (!o || selected.has(s.optionId) || !o.values.some((v: CatalogVariantOptionValue) => v.valueId === s.valueId))
        catalogFail("STORAGE_UNAVAILABLE", "variant selection is invalid");
      selected.add(s.optionId);
    }
    if (selected.size !== p.options.length || combinations.has(key(m.selections)))
      catalogFail("STORAGE_UNAVAILABLE", "duplicate variant combinations are invalid");
    combinations.add(key(m.selections));
  }
  if (p.defaultMemberId !== productId || !members.has(productId)) catalogFail("STORAGE_UNAVAILABLE", "variant default member is invalid");
  return p;
}

export async function resolveCatalogVariantMember(
  catalog: Pick<CatalogVariantStorage["catalog"], "get">, catalogItemId: string,
): Promise<CatalogVariantResolution | null> {
  const raw = await catalog.get(catalogItemId);
  if (!raw || raw.recordKind !== "catalog-item" || raw.itemId !== catalogItemId) return null;
  let item = raw as CatalogItemRecord;
  if (!item.variantProductId) {
    item = catalogItemState(item, item);
    if (item.variantProduct) {
      const product = valid(item.variantProduct, item.itemId);
      const found = product.members.find(m => m.catalogItemId === item.itemId) ?? null;
      return found ? { item, product, member: found } : null;
    }
    if (item.variantSelections || item.variantFulfillment) catalogFail("STORAGE_UNAVAILABLE", "variant member linkage is incomplete");
    return { item, product: null, member: null };
  }
  const parent = await catalog.get(item.variantProductId);
  if (!parent || parent.recordKind !== "catalog-item" || parent.itemId !== item.variantProductId || !parent.variantProduct) return null;
  const product = valid(parent.variantProduct, item.variantProductId);
  item = catalogItemState(item, parent);
  const found = product.members.find(m => m.catalogItemId === item.itemId) ?? null;
  const own = item.variantSelections ?? [];
  return found && own.length > 0 && own.every(s => found.selections.some(f => f.optionId === s.optionId && f.valueId === s.valueId))
    ? { item, product, member: found, parent: parent as CatalogItemRecord } : null;
}

export async function addCatalogVariantMember(
  storage: CatalogVariantStorage, raw: AddCatalogVariantMemberInput,
  options: { createId?: () => string; now?: () => Date; collection?: string; pluginId?: string } = {},
): Promise<{ changed: boolean; product: CatalogVariantProduct }> {
  if (!isRecord(raw)) catalogFail("INVALID_INPUT", "variant input must be an object");
  const productId = id(raw.productId, "productId");
  const parent = await storage.catalog.getVersioned(productId);
  if (!parent || parent.value.recordKind !== "catalog-item" || parent.value.itemId !== productId || !parent.value.variantProduct)
    catalogFail("CATALOG_ITEM_NOT_FOUND", "product has no options");
  const p = valid(parent.value.variantProduct, productId);
  if (p.creationPayload === payload(raw)) return { changed: false, product: p };
  if (!p.options.length) catalogFail("INVALID_INPUT", "variant product has no options");
  // A new member is always fenced by the caller's revision, so a stale request cannot write old member values.
  if (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0) catalogFail("INVALID_INPUT", "invalid expectedRevision");
  if (raw.expectedRevision !== p.revision) catalogFail("COMMAND_CONFLICT", "options changed; reload first");
  if (p.members.length >= 50) catalogFail("INVALID_INPUT", "variant member cap exceeded");
  if (!Array.isArray(raw.selections) || raw.selections.length !== p.options.length)
    catalogFail("INVALID_INPUT", "new member requires a value for every option");
  const nextOptions = p.options.map(o => ({ ...o, values: [...o.values] }));
  const seenOptions = new Set<string>(), byOption = new Map<string, string>();
  for (const s of raw.selections) {
    if (!isRecord(s)) catalogFail("INVALID_INPUT", "variant selection is required");
    const oId = id(s.optionId, "optionId"), vId = id(s.valueId, "valueId");
    const o = nextOptions.find(x => x.optionId === oId);
    if (!o || seenOptions.has(oId)) catalogFail("INVALID_INPUT", "new member requires a value for every option");
    seenOptions.add(oId);
    if (!o.values.some(v => v.valueId === vId)) {
      if (s.label === undefined || o.values.length >= 50) catalogFail("INVALID_INPUT", "unknown variant value");
      o.values.push({ valueId: vId, label: text(s.label, "value label") });
    }
    byOption.set(oId, vId);
  }
  const selections = nextOptions.map(o => ({ optionId: o.optionId, valueId: byOption.get(o.optionId)! }));
  if (p.members.some(m => same(m.selections, selections))) catalogFail("INVALID_INPUT", "duplicate variant combinations are invalid");
  const f = fill(raw.fulfillment), commandId = id(raw.commandId, "commandId"), name = text(raw.name, "name"), sku = text(raw.sku, "sku");
  const created = await createCatalogItem(storage.catalog as never, { commandId, name, sku, fulfillment: f }, {
    ...options, variantMember: { productId, selections, fulfillment: f },
  });
  if (created.item.itemId === productId || p.members.some(m => m.catalogItemId === created.item.itemId))
    catalogFail("INVALID_INPUT", "only the permanent default item may be reused");
  const next: CatalogVariantProduct = {
    ...p, creationPayload: payload(raw), revision: p.revision + 1, options: nextOptions,
    members: [...p.members, { catalogItemId: created.item.itemId, selections, fulfillment: f }],
  };
  valid(next, productId);
  if (!(await storage.catalog.compareAndSet(productId, parent.revision, { ...(parent.value as CatalogItemRecord), variantProduct: next })).applied)
    catalogFail("STORAGE_UNAVAILABLE", "variant membership changed concurrently");
  return { changed: true, product: next };
}

export async function addCatalogVariantOption(
  storage: CatalogVariantStorage, raw: AddCatalogVariantOptionInput | AddCatalogVariantMemberInput,
  options: { createId?: () => string; now?: () => Date; collection?: string; pluginId?: string } = {},
): Promise<{ changed: boolean; product: CatalogVariantProduct }> {
  if (!isRecord(raw)) catalogFail("INVALID_INPUT", "variant input must be an object");
  if ((raw as AddCatalogVariantOptionInput).optionId === undefined && Array.isArray((raw as AddCatalogVariantMemberInput).selections))
    return addCatalogVariantMember(storage, raw as AddCatalogVariantMemberInput, options);
  const input = raw as AddCatalogVariantOptionInput;
  const productId = id(input.productId, "productId");
  const parent = await storage.catalog.getVersioned(productId);
  if (!parent || parent.value.recordKind !== "catalog-item" || parent.value.itemId !== productId)
    catalogFail("CATALOG_ITEM_NOT_FOUND", "product was not found");
  const current = (parent.value as CatalogItemRecord).variantProduct;
  const p: CatalogVariantProduct = current ? valid(current, productId) : {
    schema: "dinkuskit.commerce.product-variants/v1", productId, revision: 0, defaultMemberId: productId,
    options: [], members: [{ catalogItemId: productId, selections: [], fulfillment: (parent.value as CatalogItemRecord).variantFulfillment ?? "physical" }],
  };
  if (current && p.creationPayload === payload(input)) return { changed: false, product: p };
  // Only the first option may come without a revision (v1 callers); appending one must name the revision it read.
  if (input.expectedRevision === undefined) {
    if (p.options.length) catalogFail("COMMAND_CONFLICT", "options already exist; reload first");
  } else {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) catalogFail("INVALID_INPUT", "invalid expectedRevision");
    if (input.expectedRevision !== (current ? p.revision : 0)) catalogFail("COMMAND_CONFLICT", "options changed; reload first");
  }
  const optionId = id(input.optionId, "optionId"), optionLabel = text(input.optionLabel, "option label");
  if (p.options.some(o => o.optionId === optionId))
    catalogFail("INVALID_INPUT", "variant option already exists");
  if (p.options.length >= 3) catalogFail("INVALID_INPUT", "variant option cap exceeded");
  const empty = p.options.length === 0;
  if (!Array.isArray(input.values) || input.values.length < 2 || input.values.length > 50 ||
      (empty && input.members === undefined && (!input.values[0]?.member || input.values[0].member.catalogItemId !== productId)))
    catalogFail("INVALID_INPUT", "an option needs 2-50 values and keeps the default member");
  const values: CatalogVariantOptionValue[] = [], seenValues = new Set<string>();
  const entries: { entry: VariantMemberInput; defaultValueId?: string }[] = [];
  for (const [i, v] of input.values.entries()) {
    if (!isRecord(v)) catalogFail("INVALID_INPUT", "variant value is required");
    const valueId = id(v.valueId, "valueId"), label = text(v.label, "value label");
    if (seenValues.has(valueId)) catalogFail("INVALID_INPUT", "duplicate variant values are invalid");
    seenValues.add(valueId); values.push({ valueId, label });
    if (empty && input.members === undefined && (!v.member || typeof v.member !== "object")) catalogFail("INVALID_INPUT", "variant member is required");
    if (v.member !== undefined) {
      if (!isRecord(v.member)) catalogFail("INVALID_INPUT", "variant member is required");
      if (empty && i > 0 && v.member.catalogItemId !== undefined) catalogFail("INVALID_INPUT", "only the permanent default item may be reused");
      entries.push({ entry: v.member, defaultValueId: valueId });
    }
    if (v.members !== undefined) {
      if (!Array.isArray(v.members)) catalogFail("INVALID_INPUT", "invalid variant members");
      for (const m of v.members) {
        if (!isRecord(m)) catalogFail("INVALID_INPUT", "variant member is required");
        entries.push({ entry: m, defaultValueId: valueId });
      }
    }
  }
  if (input.members !== undefined) {
    if (!Array.isArray(input.members)) catalogFail("INVALID_INPUT", "invalid variant members");
    for (const m of input.members) {
      if (!isRecord(m)) catalogFail("INVALID_INPUT", "variant member is required");
      entries.push({ entry: m });
    }
  }
  const existingById = new Map(p.members.map(m => [m.catalogItemId, m]));
  const assigned = new Map<string, { valueId: string; fulfillment: CatalogFulfillment }>();
  const toCreate: { commandId: string; name: string; sku: string; fulfillment: CatalogFulfillment; selections: CatalogVariantSelection[] }[] = [];
  const nextOptions = [...p.options.map(o => ({ ...o, values: [...o.values] })), { optionId, label: optionLabel, values }];
  for (const { entry, defaultValueId } of entries) {
    const selVal = Array.isArray(entry.selections) ? entry.selections.find(s => isRecord(s) && s.optionId === optionId)?.valueId : undefined;
    const valueId = id(entry.valueId ?? selVal ?? defaultValueId, "valueId");
    if (!seenValues.has(valueId)) catalogFail("INVALID_INPUT", "unknown variant value");
    if (entry.catalogItemId !== undefined) {
      const memberId = id(entry.catalogItemId, "catalogItemId"), prev = existingById.get(memberId);
      if (!prev || assigned.has(memberId) || entry.commandId !== undefined || entry.sku !== undefined)
        catalogFail("INVALID_INPUT", "only existing members may be reused once");
      if (Array.isArray(entry.selections)) {
        for (const s of entry.selections) {
          if (!isRecord(s) || (s.optionId !== optionId && !prev.selections.some(x => x.optionId === s.optionId && x.valueId === s.valueId)))
            catalogFail("INVALID_INPUT", "existing member selection mismatch");
        }
      }
      assigned.set(memberId, { valueId, fulfillment: entry.fulfillment !== undefined ? fill(entry.fulfillment) : prev.fulfillment });
    } else {
      const f = fill(entry.fulfillment), commandId = id(entry.commandId, "commandId"), name = text(entry.name, "name"), sku = text(entry.sku, "sku");
      const selections: CatalogVariantSelection[] = [];
      if (Array.isArray(entry.selections)) {
        const seen = new Set<string>();
        for (const s of entry.selections) {
          if (!isRecord(s) || seen.has(String(s.optionId)) || !nextOptions.some(o => o.optionId === s.optionId))
            catalogFail("INVALID_INPUT", "variant selection is invalid");
          seen.add(String(s.optionId));
        }
      }
      for (const o of nextOptions.slice(0, -1)) {
        const s = Array.isArray(entry.selections) ? entry.selections.find(x => isRecord(x) && x.optionId === o.optionId) : undefined;
        if (!s) catalogFail("INVALID_INPUT", "new member requires a value for every option");
        const vId = id(s.valueId, "valueId");
        if (!o.values.some(v => v.valueId === vId)) {
          if (s.label === undefined || o.values.length >= 50) catalogFail("INVALID_INPUT", "unknown variant value");
          o.values.push({ valueId: vId, label: text(s.label, "value label") });
        }
        selections.push({ optionId: o.optionId, valueId: vId });
      }
      selections.push({ optionId, valueId });
      toCreate.push({ commandId, name, sku, fulfillment: f, selections });
    }
  }
  if (assigned.size !== p.members.length) catalogFail("INVALID_INPUT", "every existing member requires a value for the new option");
  const totalMembers = p.members.length + toCreate.length;
  if (totalMembers < 2 || totalMembers > 50) catalogFail("INVALID_INPUT", "variant product requires 2-50 members");
  const comboSet = new Set<string>();
  for (const sel of [
    ...p.members.map(m => [...m.selections, { optionId, valueId: assigned.get(m.catalogItemId)!.valueId }]),
    ...toCreate.map(c => c.selections),
  ]) {
    const k = key(sel);
    if (comboSet.has(k)) catalogFail("INVALID_INPUT", "duplicate variant combinations are invalid");
    comboSet.add(k);
  }
  const createdMembers: CatalogVariantMember[] = [];
  for (const c of toCreate) {
    const created = await createCatalogItem(storage.catalog as never, { commandId: c.commandId, name: c.name, sku: c.sku, fulfillment: c.fulfillment }, {
      ...options, variantMember: { productId, selections: c.selections, fulfillment: c.fulfillment },
    });
    if (created.item.itemId === productId || existingById.has(created.item.itemId) || createdMembers.some(m => m.catalogItemId === created.item.itemId))
      catalogFail("INVALID_INPUT", "only the permanent default item may be reused");
    createdMembers.push({ catalogItemId: created.item.itemId, selections: c.selections, fulfillment: c.fulfillment });
  }
  const members: CatalogVariantMember[] = [
    ...p.members.map(m => {
      const a = assigned.get(m.catalogItemId)!;
      return { catalogItemId: m.catalogItemId, selections: [...m.selections, { optionId, valueId: a.valueId }], fulfillment: a.fulfillment };
    }),
    ...createdMembers,
  ];
  const product: CatalogVariantProduct = {
    creationPayload: payload(input), schema: "dinkuskit.commerce.product-variants/v1", productId,
    revision: current ? p.revision + 1 : 1, defaultMemberId: productId,
    options: nextOptions, members,
  };
  valid(product, productId);
  const committed = await storage.catalog.compareAndSet(productId, parent.revision, { ...(parent.value as CatalogItemRecord), variantProduct: product });
  if (!committed.applied) catalogFail("STORAGE_UNAVAILABLE", "variant membership changed concurrently");
  return { changed: true, product };
}

export async function updateCatalogVariantLabels(storage: CatalogVariantStorage, raw: UpdateCatalogVariantLabelsInput) {
  if (!isRecord(raw)) catalogFail("INVALID_INPUT", "variant input must be an object");
  const productId = id(raw.productId, "productId");
  if (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0 ||
      (raw.values !== undefined && !Array.isArray(raw.values)) ||
      (raw.options !== undefined && !Array.isArray(raw.options)) ||
      (raw.members !== undefined && !Array.isArray(raw.members)) ||
      (raw.values === undefined && raw.options === undefined && raw.optionLabel === undefined && raw.members === undefined))
    catalogFail("INVALID_INPUT", "invalid variant label update");
  const parent = await storage.catalog.getVersioned(productId);
  if (!parent || parent.value.recordKind !== "catalog-item" || !parent.value.variantProduct) catalogFail("CATALOG_ITEM_NOT_FOUND", "product has no options");
  const p = valid(parent.value.variantProduct, productId);
  if (p.revision !== raw.expectedRevision) catalogFail("COMMAND_CONFLICT", "options changed; reload first");
  const optionLabels = new Map<string, string>();
  if (raw.optionLabel !== undefined) {
    const targetId = raw.optionId !== undefined ? id(raw.optionId, "optionId") : p.options[0]?.optionId;
    if (!targetId || !p.options.some(o => o.optionId === targetId)) catalogFail("INVALID_INPUT", "unknown or duplicate option");
    optionLabels.set(targetId, text(raw.optionLabel, "option label"));
  }
  for (const o of raw.options ?? []) {
    if (!isRecord(o)) catalogFail("INVALID_INPUT", "invalid variant label update");
    const oId = id(o.optionId, "optionId"), label = text(o.label, "option label");
    if (optionLabels.has(oId) || !p.options.some(x => x.optionId === oId)) catalogFail("INVALID_INPUT", "unknown or duplicate option");
    optionLabels.set(oId, label);
  }
  const scopedValues = new Map<string, string>(), unscopedValues = new Map<string, string>();
  for (const v of raw.values ?? []) {
    if (!isRecord(v)) catalogFail("INVALID_INPUT", "invalid variant label update");
    const vId = id(v.valueId, "valueId"), label = text(v.label, "value label");
    if (v.optionId !== undefined) {
      const oId = id(v.optionId, "optionId"), k = JSON.stringify([oId, vId]);
      if (scopedValues.has(k) || !p.options.some(o => o.optionId === oId && o.values.some(x => x.valueId === vId)))
        catalogFail("INVALID_INPUT", "unknown or duplicate value");
      scopedValues.set(k, label);
    } else {
      if (unscopedValues.has(vId) || !p.options.some(o => o.values.some(x => x.valueId === vId)))
        catalogFail("INVALID_INPUT", "unknown or duplicate value");
      unscopedValues.set(vId, label);
    }
  }
  const fulfillment = new Map((raw.members ?? []).map(m => [id(m?.catalogItemId, "catalogItemId"), fill(m?.fulfillment)]));
  if (fulfillment.size !== (raw.members?.length ?? 0) || [...fulfillment.keys()].some(k => !p.members.some(m => m.catalogItemId === k)))
    catalogFail("INVALID_INPUT", "unknown or duplicate member");
  const next = { ...p, revision: p.revision + 1, options: p.options.map(o => ({
    ...o, ...(optionLabels.has(o.optionId) ? { label: optionLabels.get(o.optionId)! } : {}),
    values: o.values.map(v => {
      const nextLabel = scopedValues.get(JSON.stringify([o.optionId, v.valueId])) ?? unscopedValues.get(v.valueId);
      return nextLabel !== undefined ? { ...v, label: nextLabel } : v;
    }),
  })), members: p.members.map(m => ({ ...m, fulfillment: fulfillment.get(m.catalogItemId) ?? m.fulfillment })) };
  valid(next, productId);
  if (!(await storage.catalog.compareAndSet(productId, parent.revision, { ...(parent.value as CatalogItemRecord), variantProduct: next })).applied)
    catalogFail("STORAGE_UNAVAILABLE", "variant labels changed concurrently");
  return { changed: true, product: next };
}

export function variantSelections(product: CatalogVariantProduct, member: CatalogVariantMember) {
  return member.selections.map(s => {
    const option = product.options.find(o => o.optionId === s.optionId), value = option?.values.find(v => v.valueId === s.valueId);
    if (!option || !value) catalogFail("STORAGE_UNAVAILABLE", "variant selection is invalid");
    return { optionId: option.optionId, optionLabel: option.label, valueId: value.valueId, valueLabel: value.label };
  });
}
