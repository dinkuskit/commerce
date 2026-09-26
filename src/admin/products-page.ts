import { createElement, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

import {
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  catalogProductCreateInput,
  type CatalogProductListItem,
  type CatalogProductPriceForm,
} from "../features/catalog/index.js";

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

export function ProductsPage() {
  const [products, setProducts] = useState<CatalogProductListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [regular, setRegular] = useState("");
  const [sale, setSale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function loadProducts(selectId?: string): Promise<void> {
    const listed = await postPlugin<{ products: CatalogProductListItem[] }>(
      LIST_CATALOG_PRODUCTS_ROUTE,
      {},
      "Could not load products",
    );
    setProducts(listed.products);
    const nextId = selectId ?? selectedId;
    const selected = listed.products.find((product) => product.catalogItemId === nextId) ?? null;
    if (selected === null) {
      setSelectedId(null);
      setRegular("");
      setSale("");
      return;
    }
    setSelectedId(selected.catalogItemId);
    setRegular(selected.regular ?? "");
    setSale(selected.sale ?? "");
  }

  useEffect(() => {
    void loadProducts().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Could not load products");
    });
  }, []);

  function chooseProduct(product: CatalogProductListItem): void {
    setSelectedId(product.catalogItemId);
    setRegular(product.regular ?? "");
    setSale(product.sale ?? "");
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
      const saved = await postPlugin<CatalogProductPriceForm>(
        SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
        { catalogItemId: selectedId, regular, sale },
        "Could not save the price",
      );
      if (!saved.saved) {
        setMessage(saved.message);
        return;
      }
      setRegular(saved.regular);
      setSale(saved.sale);
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
          createElement("button", { type: "submit", disabled: pending }, "Save"),
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
