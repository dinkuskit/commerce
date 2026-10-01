import { fileURLToPath } from "node:url";
import { createPlugin as createCommercePlugin, dinkusCommerce } from "../../dist/index.js";
import { createCouponAdminRoutes } from "../../dist/admin/coupons-routes.js";

export function createPlugin(options = {}) {
  const base = createCommercePlugin(options);
  return {
    ...base,
    storage: {
      ...base.storage,
      coupons: { indexes: ["normalizedCode"], uniqueIndexes: ["normalizedCode"] },
    },
    admin: {
      ...base.admin,
      pages: [...(base.admin.pages ?? []), { path: "/coupons", label: "Coupons", icon: "tag" }],
    },
    routes: {
      ...base.routes,
      ...createCouponAdminRoutes((ctx) => ({ coupons: ctx.storage.coupons })),
    },
  };
}

const descriptor = dinkusCommerce();
export default {
  ...descriptor,
  entrypoint: fileURLToPath(import.meta.url),
  adminEntry: fileURLToPath(new URL("./coupon-admin.mjs", import.meta.url)),
  adminPages: [...descriptor.adminPages, { path: "/coupons", label: "Coupons", icon: "tag" }],
};
