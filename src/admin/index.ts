import type { PluginAdminExports } from "emdash";

import { ProductsPage } from "./products-page.js";

export const pages: PluginAdminExports["pages"] = {
  "/products": ProductsPage,
};
