import { createElement, useEffect, useState, type FormEvent } from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import { MerchantSettingsSection } from "./merchant-settings-page.js";

import { COMMERCE_PLUGIN_ID } from "../features/catalog/browser/index.js";
import {
  DEFAULT_HIDE_OUT_OF_STOCK,
  OUT_OF_STOCK_LISTING_ROUTE,
} from "../features/storefront-availability/browser/index.js";

function pluginRoute(route: string): string {
  return `/_emdash/api/plugins/${COMMERCE_PLUGIN_ID}/${route}`;
}

async function pluginFetch<T>(
  method: string,
  route: string,
  body: unknown,
  fallback: string,
): Promise<T> {
  const response = await apiFetch(pluginRoute(route), {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return parseApiResponse<T>(response, fallback);
}

export function StorePage() {
  const [hideOutOfStock, setHideOutOfStock] = useState(DEFAULT_HIDE_OUT_OF_STOCK);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void pluginFetch<{ hideOutOfStock: boolean }>(
      "GET",
      OUT_OF_STOCK_LISTING_ROUTE,
      {},
      "Could not load the store setting",
    )
      .then((listing) => {
        setHideOutOfStock(listing.hideOutOfStock);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Could not load the store setting");
      });
  }, []);

  async function saveListing(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const saved = await pluginFetch<{ listing: { hideOutOfStock: boolean } }>(
        "POST",
        OUT_OF_STOCK_LISTING_ROUTE,
        { hideOutOfStock },
        "Could not save the store setting",
      );
      setHideOutOfStock(saved.listing.hideOutOfStock);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the store setting");
    } finally {
      setPending(false);
    }
  }

  return createElement(
    "section",
    { className: "space-y-6" },
    createElement("h1", { className: "text-2xl font-semibold" }, "Store"),
    createElement(MerchantSettingsSection),
    message === null
      ? null
      : createElement("p", { role: "alert", className: "text-kumo-danger" }, message),
    createElement(
      "form",
      { onSubmit: (event: FormEvent) => void saveListing(event), className: "space-y-3" },
      createElement("h2", { className: "text-lg font-semibold" }, "Out-of-stock products on the shop"),
      createElement(
        "label",
        { className: "block" },
        createElement("input", {
          type: "radio",
          name: "out-of-stock-listing",
          checked: hideOutOfStock === false,
          onChange: () => {
            setHideOutOfStock(false);
          },
        }),
        " Show as out of stock",
      ),
      createElement(
        "label",
        { className: "block" },
        createElement("input", {
          type: "radio",
          name: "out-of-stock-listing",
          checked: hideOutOfStock === true,
          onChange: () => {
            setHideOutOfStock(true);
          },
        }),
        " Hide them",
      ),
      createElement("button", { type: "submit", disabled: pending }, "Save"),
    ),
  );
}
