import { createElement, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

import {
  CLERK_STOCK_STATUSES,
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
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
    setStockStatusChanged(false);
    setMessage(null);
  }

  async function addProduct(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const created = await postPlugin<{ item: { itemId: string } }>(
        CREATE_CATALOG_ITEM_ROUTE,
        catalogProductCreateInput(name, sku, crypto.randomUUID()),
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

  return createElement(
    "section",
    { className: "space-y-6" },
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
        ),
  );
}

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
) {
  return createElement(
    "div",
    { className: "dk-manage-stock-row" },
    createElement("style", null, SWITCH_STYLE),
    createElement("label", { htmlFor: "manage-stock" }, "Manage stock"),
    createElement("input", {
      id: "manage-stock",
      type: "checkbox",
      role: "switch",
      checked: value,
      disabled: !enabled,
      "aria-checked": value,
      "aria-disabled": enabled ? undefined : "true",
      "aria-describedby": enabled ? undefined : "manage-stock-coming-soon",
      onChange: enabled
        ? (event: ChangeEvent<HTMLInputElement>) => {
            setValue(event.currentTarget.checked);
          }
        : undefined,
    }),
    enabled
      ? null
      : createElement("span", { id: "manage-stock-coming-soon" }, "Coming soon"),
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
