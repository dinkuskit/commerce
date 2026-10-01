import type { PluginAdminExports } from "emdash";

import { ProductsPage } from "./products-page.js";
import { StorePage } from "./store-page.js";
import { CouponsPage } from "./coupons-page.js";
import { couponsMenu } from "./coupons-contract.js";

export { CouponsPage } from "./coupons-page.js";

export const pages: PluginAdminExports["pages"] = {
  "/products": ProductsPage,
  "/store": StorePage,
  "/coupons": CouponsPage,
};

/** Core-owned host registration consumes this declaration when mounting admin navigation. */
export const menu = couponsMenu;
