import { createElement, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

import {
  CLERK_STOCK_STATUSES,
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_PRODUCT_FEED_ELIGIBILITY_ROUTE,
  SET_CATALOG_ITEM_IDENTIFIERS_ROUTE,
  catalogProductCreateInput,
  type CatalogProductListItem,
  type CatalogProductPriceForm,
  type ClerkStockStatus,
  type ManageStockControl,
} from "../features/catalog/browser/index.js";

/** Native list rows carry Feeds' channel choices beside Catalog's fields. */
type ListedProduct = CatalogProductListItem & { feedChannels?: readonly string[] };

function pluginRoute(route: string): string {
  return `/_emdash/api/plugins/${COMMERCE_PLUGIN_ID}/${route}`;
}

async function postPlugin<T>(route: string, body: unknown, fallback: string): Promise<T> {
  const response = await apiFetch(pluginRoute(route), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(response, fallback);
}

function readManageStockEnabled(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const control = (value as { manageStockControl?: ManageStockControl }).manageStockControl;
  return control?.enabled === true;
}

export function ProductsPage() {
  const [products, setProducts] = useState<ListedProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [regular, setRegular] = useState("");
  const [sale, setSale] = useState("");
  const [stockStatus, setStockStatus] = useState<ClerkStockStatus>("in-stock");
  const [stockStatusChanged, setStockStatusChanged] = useState(false);
  const [manageStock, setManageStock] = useState(false);
  const [manageStockEnabled, setManageStockEnabled] = useState(false);
  const [feedChannels, setFeedChannels] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [optionLabel, setOptionLabel] = useState("Size");
  const [smallLabel, setSmallLabel] = useState("Small");
  const [largeLabel, setLargeLabel] = useState("Large");
  const [newSku, setNewSku] = useState("");
  const [firstFulfillment, setFirstFulfillment] = useState("");
  const [secondFulfillment, setSecondFulfillment] = useState("");
  const [creationFulfillment, setCreationFulfillment] = useState("");
  const [gtin, setGtin] = useState("");
  const [mpn, setMpn] = useState("");
  const [brand, setBrand] = useState("");
  const [rename, setRename] = useState("");
  const [choiceIds, setChoiceIds] = useState(() => Array.from({ length: 4 }, () => crypto.randomUUID()));
  useEffect(() => { setChoiceIds(Array.from({ length: 4 }, () => crypto.randomUUID())); setFirstFulfillment(""); setSecondFulfillment(""); }, [selectedId]);

  async function loadProducts(selectId?: string): Promise<void> {
    const listed = await postPlugin<{
      products: ListedProduct[];
      manageStockControl?: ManageStockControl;
    }>(LIST_CATALOG_PRODUCTS_ROUTE, {}, "Could not load products");
    setProducts(listed.products);
    setManageStockEnabled(readManageStockEnabled(listed));
    setStockStatusChanged(false);
    const nextId = selectId ?? selectedId;
    const selected = listed.products.find((product) => product.catalogItemId === nextId) ?? null;
    if (selected === null) {
      setSelectedId(null);
      setRegular("");
      setSale("");
      setStockStatus("in-stock");
      return;
    }
    setSelectedId(selected.catalogItemId);
    setRename(selected.name);
    setRegular(selected.regular ?? "");
    setSale(selected.sale ?? "");
    setManageStock(selected.manageStock);
    setStockStatus(selected.stockStatus ?? "in-stock");
    setFeedChannels([...(selected.feedChannels ?? [])]);
    setGtin(selected.gtin ?? "");
    setMpn(selected.mpn ?? "");
    setBrand(selected.brand ?? "");
    const variant = (selected as CatalogProductListItem & { variantProduct?: {
      options: readonly { label: string }[]; members: readonly { selections: readonly { valueId: string }[]; fulfillment: string }[];
    }}).variantProduct;
    setOptionLabel(variant?.options[0]?.label ?? "Size");
  }

  useEffect(() => {
    void loadProducts().catch((error: unknown) => {
      setManageStockEnabled(false);
      setMessage(error instanceof Error ? error.message : "Could not load products");
    });
  }, []);

  function chooseProduct(product: ListedProduct): void {
    setSelectedId(product.catalogItemId);
    setRename(product.name);
    setRegular(product.regular ?? "");
    setSale(product.sale ?? "");
    setManageStock(product.manageStock);
    setStockStatus(product.stockStatus ?? "in-stock");
    setFeedChannels([...(product.feedChannels ?? [])]);
    setGtin(product.gtin ?? "");
    setMpn(product.mpn ?? "");
    setBrand(product.brand ?? "");
    setStockStatusChanged(false);
    setMessage(null);
  }

  async function saveIdentifiers(): Promise<void> {
    if (selectedId === null) return;
    setPending(true);
    setMessage(null);
    try {
      await postPlugin(
        SET_CATALOG_ITEM_IDENTIFIERS_ROUTE,
        {
          catalogItemId: selectedId,
          gtin: gtin.trim() ? gtin.trim() : null,
          mpn: mpn.trim() ? mpn.trim() : null,
          brand: brand.trim() ? brand.trim() : null,
        },
        "Could not save identifiers",
      );
      await loadProducts(selectedId);
      setMessage("Identifiers saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save identifiers");
    } finally {
      setPending(false);
    }
  }

  async function addProduct(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const created = await postPlugin<{ item: { itemId: string } }>(
        CREATE_CATALOG_ITEM_ROUTE,
        { ...catalogProductCreateInput(name, sku, crypto.randomUUID()), ...(creationFulfillment ? { fulfillment: creationFulfillment } : {}) },
        "Could not add the product",
      );
      setName("");
      setSku("");
      await loadProducts(created.item.itemId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add the product");
    } finally {
      setPending(false);
    }
  }

  async function savePrices(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (selectedId === null) return;
    setPending(true);
    setMessage(null);
    try {
      const listedManaged =
        products.find((product) => product.catalogItemId === selectedId)?.manageStock ===
        true;
      const saved = await postPlugin<CatalogProductPriceForm>(
        SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
        manageStockEnabled
          ? manageStock
            ? { catalogItemId: selectedId, regular, sale, manageStock: true }
            : listedManaged && !stockStatusChanged
              ? { catalogItemId: selectedId, regular, sale, manageStock: false }
              : {
                  catalogItemId: selectedId,
                  regular,
                  sale,
                  manageStock: false,
                  stockStatus,
                }
          : listedManaged
            ? { catalogItemId: selectedId, regular, sale }
            : {
                catalogItemId: selectedId,
                regular,
                sale,
                ...(stockStatusChanged ? { stockStatus } : {}),
              },
        "Could not save the product",
      );
      if (!saved.saved) {
        setMessage(saved.message);
        setManageStock(saved.manageStock);
        if (saved.stockStatus !== null) setStockStatus(saved.stockStatus);
        return;
      }
      setRegular(saved.regular);
      setSale(saved.sale);
      setManageStock(saved.manageStock);
      if (saved.stockStatus !== null) setStockStatus(saved.stockStatus);
      await loadProducts(selectedId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the price");
    } finally {
      setPending(false);
    }
  }

  async function saveFeedChannels(): Promise<void> {
    if (selectedId === null) return;
    setPending(true);
    setMessage(null);
    try {
      await postPlugin(SET_PRODUCT_FEED_ELIGIBILITY_ROUTE, {
        catalogItemId: selectedId,
        channels: feedChannels,
      }, "Could not save feed eligibility");
      setMessage("Feed eligibility saved");
      await loadProducts(selectedId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save feed eligibility");
    } finally {
      setPending(false);
    }
  }

  async function addChoices(): Promise<void> {
    if (!selectedId) return;
    setPending(true);
    try {
      await postPlugin("catalog-items/add-variant-option", {
        productId: selectedId, optionId: choiceIds[0], optionLabel,
        values: [
          { valueId: choiceIds[1], label: smallLabel, member: { catalogItemId: selectedId, fulfillment: firstFulfillment } },
          { valueId: choiceIds[2], label: largeLabel, member: {
            commandId: choiceIds[3], name: products.find(product => product.catalogItemId === selectedId)?.name ?? "Product",
            sku: newSku, fulfillment: secondFulfillment,
          } },
        ],
      }, "Could not add choices");
      await loadProducts(selectedId);
      setMessage("Variant choices saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add choices");
    } finally {
      setPending(false);
    }
  }

  async function editProduct(route: string, body: Record<string, unknown>, done: string): Promise<void> {
    if (selectedId === null) return;
    setPending(true);
    setMessage(null);
    try {
      await postPlugin(route, { catalogItemId: selectedId, ...body }, "Could not save");
      await loadProducts(selectedId);
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save");
    } finally {
      setPending(false);
    }
  }

  const selectedProduct = products.find((product) => product.catalogItemId === selectedId);
  // The id is what a product page's Commerce product field needs; archive hides without deleting.
  const productDetails = selectedProduct && createElement(
    "div",
    { className: "space-y-3" },
    selectedProduct.archivedAt ? createElement("p", { role: "status" }, "Archived: not in the shop and can't be bought.") : null,
    createElement("p", null, "Product ID, for a product page's Commerce product field:"),
    createElement("div", { className: "dk-product-id" },
      createElement("code", null, selectedProduct.catalogItemId),
      createElement("button", { type: "button", "aria-label": "Copy product ID", title: "Copy product ID", onClick: () => {
        void navigator.clipboard.writeText(selectedProduct.catalogItemId).then(() => setMessage("Product ID copied"), () => setMessage("Could not copy. Select the ID and copy it."));
      } }, createElement("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", fill: "none", stroke: "currentColor", strokeWidth: 1.5 },
        createElement("rect", { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }),
        createElement("path", { d: "M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" })))),
    labeledField("Name", "product-rename", rename, setRename),
    createElement("button", { type: "button", disabled: pending,
      onClick: () => void editProduct("catalog-items/rename", { name: rename }, "Product renamed") }, "Rename"),
    createElement("button", { type: "button", disabled: pending, onClick: () => {
      const archived = !selectedProduct.archivedAt;
      if (archived && !window.confirm("Archive " + selectedProduct.name + "? It leaves the shop and can't be bought. Past orders keep it. You can restore it later.")) return;
      void editProduct("catalog-items/set-archived", { archived }, archived ? "Product archived" : "Product restored");
    } }, selectedProduct.archivedAt ? "Restore product" : "Archive product"),
  );

  // Variant parents carry identifiers too; their public projection feeds structured data.
  const identifiersForm = createElement(
    "div",
    { className: "space-y-3" },
    createElement("h3", { className: "text-base font-semibold" }, "Identifiers"),
    createElement("p", { className: "text-sm opacity-80" }, "Optional. Leave blank to omit from structured data."),
    labeledField("GTIN", "product-gtin", gtin, setGtin),
    labeledField("MPN", "product-mpn", mpn, setMpn),
    labeledField("Brand", "product-brand", brand, setBrand),
    createElement(
      "button",
      { type: "button", disabled: pending, onClick: () => void saveIdentifiers() },
      "Save identifiers",
    ),
  );

  return createElement(
    "section",
    { className: "dk-products space-y-6" },
    createElement("style", null, PRODUCTS_STYLE),
    createElement("h1", { className: "text-2xl font-semibold" }, "Products"),
    message === null
      ? null
      : createElement("p", { role: "alert", className: "text-kumo-danger" }, message),
    createElement(
      "form",
      { onSubmit: (event: FormEvent) => void addProduct(event), className: "space-y-3" },
      createElement("h2", { className: "text-lg font-semibold" }, "Add product"),
      labeledField("Name", "product-name", name, setName),
      labeledField("SKU", "product-sku", sku, setSku),
      fulfillmentSelect("Fulfillment", creationFulfillment, setCreationFulfillment),
      createElement(
        "button",
        { type: "submit", disabled: pending },
        "Add product",
      ),
    ),
    createElement(
      "ul",
      { className: "space-y-2" },
      products.map((product) =>
        createElement(
          "li",
          { key: product.catalogItemId },
          createElement(
            "button",
            {
              type: "button",
              onClick: () => chooseProduct(product),
              "aria-current": product.catalogItemId === selectedId ? "true" : undefined,
            },
            product.name + (product.archivedAt ? " (archived)" : ""),
          ),
        ),
      ),
    ),
    selectedId === null
      ? null
      : products.find(p => p.catalogItemId === selectedId)?.variantProduct?.options.length
        ? createElement(
            "div",
            { className: "space-y-6" },
            productDetails,
            identifiersForm,
            createElement(VariantProductEditor, { product: products.find(p => p.catalogItemId === selectedId)!, reload: () => loadProducts(selectedId) }),
          )
      : createElement(
          "div",
          { className: "space-y-6" },
          createElement(
            "form",
            { onSubmit: (event: FormEvent) => void savePrices(event), className: "space-y-3" },
            createElement("h2", { className: "text-lg font-semibold" }, "Price"),
            labeledField("Regular", "regular-price", regular, setRegular),
            labeledField("Sale", "sale-price", sale, setSale),
            manageStockSwitch(manageStock, manageStockEnabled, setManageStock),
            manageStock
              ? null
              : stockStatusFields(stockStatus, (status) => {
                  setStockStatus(status);
                  setStockStatusChanged(true);
                }),
            createElement("button", { type: "submit", disabled: pending }, "Save"),
          createElement("fieldset", { className: "space-y-2" },
            createElement("legend", null, "Product feeds"),
            createElement("label", null,
              createElement("input", {
                type: "checkbox",
                checked: feedChannels.includes("google-merchant"),
                onChange: (event: ChangeEvent<HTMLInputElement>) => setFeedChannels(
                  event.currentTarget.checked
                    ? [...feedChannels, "google-merchant"]
                    : feedChannels.filter((channel) => channel !== "google-merchant"),
                ),
              }),
              " Google Merchant",
            ),
            createElement("label", null,
              createElement("input", {
                type: "checkbox",
                checked: feedChannels.includes("meta-catalog"),
                onChange: (event: ChangeEvent<HTMLInputElement>) => setFeedChannels(
                  event.currentTarget.checked
                    ? [...feedChannels, "meta-catalog"]
                    : feedChannels.filter((channel) => channel !== "meta-catalog"),
                ),
              }),
              " Meta catalog",
            ),
            createElement("button", { type: "button", disabled: pending, onClick: () => void saveFeedChannels() }, "Save feed eligibility"),
          ),
          ),
          productDetails,
          identifiersForm,
          createElement("div", null,
            createElement("h3", null, "Add choices"),
            labeledField("Option", "variant-option", optionLabel, setOptionLabel),
            labeledField("First value", "variant-small", smallLabel, setSmallLabel),
            labeledField("Second value", "variant-large", largeLabel, setLargeLabel),
            labeledField("New variant SKU", "variant-sku", newSku, setNewSku),
            fulfillmentSelect("First fulfillment", firstFulfillment, setFirstFulfillment),
            fulfillmentSelect("Second fulfillment", secondFulfillment, setSecondFulfillment),
            createElement("button", { type: "button", onClick: () => void addChoices(), disabled: pending }, "Add choices"),
          ),
        ),
  );
}

function fulfillmentSelect(label: string, value: string, change: (value: string) => void) {
  return createElement("label", null, label, createElement("select", {
    value, onChange: (e: ChangeEvent<HTMLSelectElement>) => change(e.currentTarget.value),
  }, createElement("option", { value: "" }, "Choose fulfillment"),
    createElement("option", { value: "physical" }, "Physical"), createElement("option", { value: "digital" }, "Digital")));
}

function VariantProductEditor({ product, reload }: { product: CatalogProductListItem; reload: () => Promise<void> }) {
  const variant = product.variantProduct!;
  const [forms, setForms] = useState<Record<string, { regular: string; sale: string; status: ClerkStockStatus; fulfillment: string }>>({});
  const [optionLabels, setOptionLabels] = useState<Record<string, string>>({});
  const [valueLabels, setValueLabels] = useState<Record<string, string>>({});
  const [nextOptionLabel, setNextOptionLabel] = useState("Color");
  const [firstOptionValue, setFirstOptionValue] = useState("Sand");
  const [secondOptionValue, setSecondOptionValue] = useState("Ink");
  const [memberOptionValues, setMemberOptionValues] = useState<Record<string, string>>({});
  const [nextOptionId, setNextOptionId] = useState(() => crypto.randomUUID());
  const [memberChoices, setMemberChoices] = useState<Record<string, string>>({});
  const [memberSku, setMemberSku] = useState("");
  const [memberFulfillment, setMemberFulfillment] = useState("physical");
  const [memberCommandId, setMemberCommandId] = useState(() => crypto.randomUUID());
  const [checked, setChecked] = useState<string[]>([]); const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null); const [pending, setPending] = useState(false);
  useEffect(() => {
    setForms(Object.fromEntries(variant.members.map(m => [m.catalogItemId, { regular: m.regular ?? "", sale: m.sale ?? "", status: m.stockStatus ?? "in-stock", fulfillment: m.fulfillment }])));
    setOptionLabels(Object.fromEntries(variant.options.map(o => [o.optionId, o.label])));
    setValueLabels(Object.fromEntries(variant.options.flatMap(o => o.values.map(v => [`${o.optionId}:${v.valueId}`, v.label]))));
    setNextOptionLabel(variant.options.length === 1 ? "Color" : "Material");
    setMemberOptionValues(prev => Object.fromEntries(variant.members.map(m => [m.catalogItemId, prev[m.catalogItemId] ?? "Sand"])));
    setMemberChoices(prev => Object.fromEntries(variant.options.map(o => [o.optionId, prev[o.optionId] ?? ""])));
  }, [variant]);
  const label = (id: string) => variant.members.find(m => m.catalogItemId === id)?.selections.map(s => s.valueLabel).join(" / ") ?? "Variant";
  async function run(work: () => Promise<void>) {
    setPending(true); setMessage(null);
    try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save changes"); } finally { setPending(false); }
  }
  const change = (id: string, field: string, value: string) => setForms({ ...forms, [id]: { ...forms[id], [field]: value } });
  async function save(id: string, event: FormEvent) {
    event.preventDefault(); const m = variant.members.find(m => m.catalogItemId === id)!; const f = forms[id];
    await run(async () => {
      const result = await postPlugin<CatalogProductPriceForm>(SAVE_CATALOG_PRODUCT_PRICES_ROUTE, {
        catalogItemId: id, regular: f.regular, sale: f.sale, expectedRevision: m.priceRevision,
        ...(!m.manageStock ? { stockStatus: f.status } : {}),
      }, "Could not save variant");
      if (!result.saved) throw new Error(result.message ?? "Invalid price");
      await reload(); setMessage(`${label(id)} saved`);
    });
  }
  async function details(event: FormEvent) {
    event.preventDefault(); await run(async () => {
      await postPlugin("catalog-items/update-variant-labels", {
        productId: product.catalogItemId, expectedRevision: variant.revision,
        options: variant.options.map(o => ({ optionId: o.optionId, label: optionLabels[o.optionId] ?? o.label })),
        values: variant.options.flatMap(o => o.values.map(v => ({ optionId: o.optionId, valueId: v.valueId, label: valueLabels[`${o.optionId}:${v.valueId}`] ?? v.label }))),
        members: variant.members.map(m => ({ catalogItemId: m.catalogItemId, fulfillment: forms[m.catalogItemId].fulfillment })),
      }, "Could not save choices"); await reload(); setMessage("Choices saved");
    });
  }
  async function appendOption(event: FormEvent) {
    event.preventDefault(); await run(async () => {
      const byLabel = new Map<string, { valueId: string; label: string }>();
      const ensure = (rawLabel: string) => {
        const l = rawLabel.trim(), k = l.toLowerCase();
        if (!byLabel.has(k)) {
          const base = k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "v";
          const valueId = [...byLabel.values()].some(v => v.valueId === base) ? `${base}-${byLabel.size + 1}` : base;
          byLabel.set(k, { valueId, label: l });
        }
        return byLabel.get(k)!.valueId;
      };
      ensure(firstOptionValue); ensure(secondOptionValue);
      const members = variant.members.map(m => ({
        catalogItemId: m.catalogItemId, valueId: ensure(memberOptionValues[m.catalogItemId] ?? ""), fulfillment: m.fulfillment,
      }));
      await postPlugin("catalog-items/add-variant-option", {
        productId: product.catalogItemId, expectedRevision: variant.revision, optionId: nextOptionId,
        optionLabel: nextOptionLabel, values: [...byLabel.values()], members,
      }, "Could not add option");
      setNextOptionId(crypto.randomUUID()); await reload(); setMessage("Option added");
    });
  }
  async function addMember(event: FormEvent) {
    event.preventDefault(); await run(async () => {
      const selections = variant.options.map((o, i) => {
        const l = (memberChoices[o.optionId] ?? "").trim(), k = l.toLowerCase();
        const found = o.values.find(v => v.label.toLowerCase() === k || v.valueId === l);
        if (found) return { optionId: o.optionId, valueId: found.valueId };
        const base = k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "v" + i;
        const valueId = o.values.some(v => v.valueId === base) ? `${base}-${o.values.length + 1}` : base;
        return { optionId: o.optionId, valueId, label: l };
      });
      await postPlugin("catalog-items/add-variant-option", {
        productId: product.catalogItemId, expectedRevision: variant.revision, commandId: memberCommandId,
        name: product.name, sku: memberSku, fulfillment: memberFulfillment, selections,
      }, "Could not add variant");
      setMemberCommandId(crypto.randomUUID()); setMemberSku(""); await reload(); setMessage("Variant added");
    });
  }
  async function bulk() {
    await run(async () => {
      const result = await postPlugin<{ outcomes: { catalogItemId: string; applied: boolean; message?: string }[] }>("catalog-items/bulk-save-prices", {
        rows: variant.members.filter(m => checked.includes(m.catalogItemId)).map(m => ({ catalogItemId: m.catalogItemId, expectedRevision: m.priceRevision, regular: amount, sale: m.sale ?? "" })),
      }, "Could not apply prices"); await reload(); setMessage(result.outcomes.map(o => `${label(o.catalogItemId)}: ${o.applied ? "saved" : o.message}`).join("; "));
    });
  }
  return createElement("div", null, createElement("h2", null, product.name), message ? createElement("p", { role: "alert" }, message) : null,
    ...variant.members.map(m => {
      const f = forms[m.catalogItemId]; if (!f) return null;
      return createElement("fieldset", { key: m.catalogItemId }, createElement("legend", null, label(m.catalogItemId)),
        createElement("label", null, createElement("input", { type: "checkbox", checked: checked.includes(m.catalogItemId),
          onChange: () => setChecked(checked.includes(m.catalogItemId) ? checked.filter(id => id !== m.catalogItemId) : [...checked, m.catalogItemId]) }), "Include in bulk price"),
        createElement("form", { onSubmit: (e: FormEvent) => void save(m.catalogItemId, e) },
          labeledField("Regular", `regular-${m.catalogItemId}`, f.regular, v => change(m.catalogItemId, "regular", v)),
          labeledField("Sale", `sale-${m.catalogItemId}`, f.sale, v => change(m.catalogItemId, "sale", v)),
          manageStockSwitch(m.manageStock, false, () => {}, `manage-stock-${m.catalogItemId}`),
          !m.manageStock ? stockStatusFields(f.status, v => change(m.catalogItemId, "status", v)) : createElement("p", null, "Managed stock"),
          createElement("button", { type: "submit", disabled: pending }, `Save ${label(m.catalogItemId)}`)),
        fulfillmentSelect(`${label(m.catalogItemId)} fulfillment`, f.fulfillment, v => change(m.catalogItemId, "fulfillment", v)));
    }),
    labeledField("Same Regular price", "bulk-regular", amount, setAmount), createElement("button", { type: "button", disabled: pending || !checked.length, onClick: () => void bulk() }, "Apply to selected variants"),
    createElement("form", { onSubmit: (e: FormEvent) => void details(e) },
      ...variant.options.flatMap((o, oi) => [
        labeledField(oi ? `Option: ${o.label}` : "Option", `choice-option-${o.optionId}`, optionLabels[o.optionId] ?? "", value => setOptionLabels({ ...optionLabels, [o.optionId]: value })),
        ...o.values.map((v, vi) => labeledField(oi ? `Value: ${v.label}` : `Value ${vi + 1}`, `choice-${o.optionId}-${v.valueId}`, valueLabels[`${o.optionId}:${v.valueId}`] ?? "", value => setValueLabels({ ...valueLabels, [`${o.optionId}:${v.valueId}`]: value }))),
      ]),
      createElement("button", { type: "submit", disabled: pending }, "Save choices")),
    variant.options.length < 3 ? createElement("form", { onSubmit: (e: FormEvent) => void appendOption(e) },
      labeledField("Next option", "next-option", nextOptionLabel, setNextOptionLabel),
      labeledField("First option value", "first-option-value", firstOptionValue, setFirstOptionValue),
      labeledField("Second option value", "second-option-value", secondOptionValue, setSecondOptionValue),
      ...variant.members.map(m => labeledField(`Value for ${label(m.catalogItemId)}`, `member-option-${m.catalogItemId}`, memberOptionValues[m.catalogItemId] ?? "Sand", value => setMemberOptionValues({ ...memberOptionValues, [m.catalogItemId]: value }))),
      createElement("button", { type: "submit", disabled: pending }, "Add option")) : null,
    variant.members.length < 50 ? createElement("form", { onSubmit: (e: FormEvent) => void addMember(e) },
      ...variant.options.map(o => labeledField(`Choice: ${o.label}`, `member-choice-${o.optionId}`, memberChoices[o.optionId] ?? "", value => setMemberChoices({ ...memberChoices, [o.optionId]: value }))),
      labeledField("Variant SKU", "member-sku", memberSku, setMemberSku),
      fulfillmentSelect("Variant fulfillment", memberFulfillment, setMemberFulfillment),
      createElement("button", { type: "submit", disabled: pending }, "Add variant")) : null);
}

const PRODUCTS_STYLE = `
.dk-product-id{display:flex;align-items:center;gap:.5rem;width:fit-content;max-width:100%;padding:.375rem .375rem .375rem .75rem;border:1px solid #9ca3af;border-radius:.5rem;box-shadow:0 1px 2px rgb(0 0 0/.15),0 2px 6px rgb(0 0 0/.08)}
.dk-product-id code{overflow-wrap:anywhere;user-select:all}.dk-products .dk-product-id button{margin:0;padding:.375rem;display:flex}
.dk-products{max-width:48rem}.dk-products form{display:grid;gap:.75rem}.dk-products label{display:block}
.dk-products input:not([type]),.dk-products select{display:block;width:min(100%,24rem);padding:.5rem;border:1px solid #9ca3af;border-radius:.375rem;background:transparent}
.dk-products fieldset{min-width:0;border:1px solid #9ca3af;border-radius:.5rem;padding:1rem;margin:.75rem 0}
.dk-products legend{font-weight:600;padding:0 .25rem}.dk-products button{border:1px solid #9ca3af;border-radius:.375rem;padding:.375rem .75rem;margin:.25rem 0;width:fit-content}
`;

const SWITCH_STYLE = `
.dk-manage-stock-row{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
.dk-manage-stock-row input[role=switch]{appearance:none;-webkit-appearance:none;width:2.5rem;height:1.4rem;margin:0;border:0;border-radius:999px;background:#6b7280;position:relative;flex:0 0 auto}
.dk-manage-stock-row input[role=switch]::after{content:"";position:absolute;top:.15rem;left:.15rem;width:1.1rem;height:1.1rem;border-radius:999px;background:#fff}
.dk-manage-stock-row input[role=switch]:checked{background:#2563eb}
.dk-manage-stock-row input[role=switch]:checked::after{left:1.25rem}
.dk-manage-stock-row input[role=switch]:disabled{filter:grayscale(1);opacity:.55;cursor:not-allowed}
`;

function manageStockSwitch(
  value: boolean,
  enabled: boolean,
  setValue: (value: boolean) => void,
  id = "manage-stock",
) {
  return createElement(
    "div",
    { className: "dk-manage-stock-row" },
    createElement("style", null, SWITCH_STYLE),
    createElement("label", { htmlFor: id }, "Manage stock"),
    createElement("input", {
      id,
      type: "checkbox",
      role: "switch",
      checked: value,
      disabled: !enabled,
      "aria-checked": value,
      "aria-disabled": enabled ? undefined : "true",
      "aria-describedby": enabled ? undefined : id + "-coming-soon",
      onChange: enabled
        ? (event: ChangeEvent<HTMLInputElement>) => {
            setValue(event.currentTarget.checked);
          }
        : undefined,
    }),
    enabled
      ? null
      : createElement("span", { id: id + "-coming-soon" }, "Coming soon"),
  );
}

const STOCK_STATUS_LABELS: Record<ClerkStockStatus, string> = {
  "in-stock": "In stock",
  "out-of-stock": "Out of stock",
  "on-backorder": "On backorder",
};

function stockStatusFields(
  value: ClerkStockStatus,
  setValue: (value: ClerkStockStatus) => void,
) {
  return createElement(
    "fieldset",
    { className: "space-y-2" },
    createElement("legend", null, "Stock status"),
    ...CLERK_STOCK_STATUSES.map((status) =>
      createElement(
        "label",
        { key: status, className: "block" },
        createElement("input", {
          type: "radio",
          name: "stock-status",
          checked: value === status,
          onClick: () => setValue(status),
          onChange: () => {
            setValue(status);
          },
        }),
        ` ${STOCK_STATUS_LABELS[status]}`,
      ),
    ),
  );
}

function labeledField(
  label: string,
  id: string,
  value: string,
  setValue: (value: string) => void,
) {
  return createElement(
    "label",
    { htmlFor: id, className: "block" },
    label,
    createElement("input", {
      id,
      value,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        setValue(event.currentTarget.value);
      },
    }),
  );
}
