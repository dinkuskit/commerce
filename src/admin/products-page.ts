import { createElement, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

import {
  CLERK_STOCK_STATUSES,
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_CATALOG_ITEM_IDENTIFIERS_ROUTE,
  catalogProductCreateInput,
  type CatalogProductListItem,
  type CatalogProductPriceForm,
  type ClerkStockStatus,
  type ManageStockControl,
} from "../features/catalog/browser/index.js";

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
  const [products, setProducts] = useState<CatalogProductListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [regular, setRegular] = useState("");
  const [sale, setSale] = useState("");
  const [stockStatus, setStockStatus] = useState<ClerkStockStatus>("in-stock");
  const [stockStatusChanged, setStockStatusChanged] = useState(false);
  const [manageStock, setManageStock] = useState(false);
  const [manageStockEnabled, setManageStockEnabled] = useState(false);
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
  const [choiceIds, setChoiceIds] = useState(() => Array.from({ length: 4 }, () => crypto.randomUUID()));
  useEffect(() => { setChoiceIds(Array.from({ length: 4 }, () => crypto.randomUUID())); setFirstFulfillment(""); setSecondFulfillment(""); }, [selectedId]);

  async function loadProducts(selectId?: string): Promise<void> {
    const listed = await postPlugin<{
      products: CatalogProductListItem[];
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
    setRegular(selected.regular ?? "");
    setSale(selected.sale ?? "");
    setManageStock(selected.manageStock);
    setStockStatus(selected.stockStatus ?? "in-stock");
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

  function chooseProduct(product: CatalogProductListItem): void {
    setSelectedId(product.catalogItemId);
    setRegular(product.regular ?? "");
    setSale(product.sale ?? "");
    setManageStock(product.manageStock);
    setStockStatus(product.stockStatus ?? "in-stock");
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
            product.name,
          ),
        ),
      ),
    ),
    selectedId === null
      ? null
      : products.find(p => p.catalogItemId === selectedId)?.variantProduct?.options.length
        ? createElement(VariantProductEditor, { product: products.find(p => p.catalogItemId === selectedId)!, reload: () => loadProducts(selectedId) })
      : createElement(
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
          createElement(
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
          ),
          (() => {
            const variant = (products.find(product => product.catalogItemId === selectedId) as CatalogProductListItem & {
              variantProduct?: { options: readonly unknown[]; members: readonly { selections: readonly { valueId: string }[]; fulfillment: string }[] };
            } | undefined)?.variantProduct;
            return createElement("div", null,
              createElement("h3", null, "Add choices"),
              labeledField("Option", "variant-option", optionLabel, setOptionLabel),
              labeledField("First value", "variant-small", smallLabel, setSmallLabel),
              labeledField("Second value", "variant-large", largeLabel, setLargeLabel),
              labeledField("New variant SKU", "variant-sku", newSku, setNewSku),
              fulfillmentSelect("First fulfillment", firstFulfillment, setFirstFulfillment),
              fulfillmentSelect("Second fulfillment", secondFulfillment, setSecondFulfillment),
              createElement("button", { type: "button", onClick: () => void addChoices(), disabled: pending }, "Add choices"),
            );
          })(),
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
  const [labels, setLabels] = useState<string[]>([]); const [option, setOption] = useState("");
  const [checked, setChecked] = useState<string[]>([]); const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null); const [pending, setPending] = useState(false);
  useEffect(() => {
    setForms(Object.fromEntries(variant.members.map(m => [m.catalogItemId, { regular: m.regular ?? "", sale: m.sale ?? "", status: m.stockStatus ?? "in-stock", fulfillment: m.fulfillment }])));
    setLabels(variant.options[0].values.map(v => v.label)); setOption(variant.options[0].label);
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
      await postPlugin("catalog-items/update-variant-labels", { productId: product.catalogItemId, expectedRevision: variant.revision, optionLabel: option,
        values: variant.options[0].values.map((v, i) => ({ valueId: v.valueId, label: labels[i] })),
        members: variant.members.map(m => ({ catalogItemId: m.catalogItemId, fulfillment: forms[m.catalogItemId].fulfillment })),
      }, "Could not save choices"); await reload(); setMessage("Choices saved");
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
    createElement("form", { onSubmit: (e: FormEvent) => void details(e) }, labeledField("Option", "choice-option", option, setOption),
      ...variant.options[0].values.map((v, i) => labeledField(`Value ${i + 1}`, `choice-${v.valueId}`, labels[i] ?? "", value => setLabels(labels.map((x, n) => n === i ? value : x)))),
      createElement("button", { type: "submit", disabled: pending }, "Save choices")));
}

const PRODUCTS_STYLE = `
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
