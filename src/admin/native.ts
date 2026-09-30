import type { PluginAdminExports } from "emdash";

import { ProductsPage } from "./products-page.js";
import { StorePage } from "./store-page.js";

export const pages: PluginAdminExports["pages"] = {
  "/products": ProductsPage,
  "/store": StorePage,
};
