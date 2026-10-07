import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";
import { commerceAdmin } from "./admin/index.js";
import {
  PUBLIC_CATALOG_ROUTE,
  readPublicCatalog,
} from "./features/catalog/kernel/index.js";
import {
  createInstalledCheckoutHandlers,
  GUEST_CHECKOUT_DECLARED_HEADERS,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  resolveRegistryCheckoutServices,
} from "./features/checkout/kernel/index.js";

const guestRequest = {
  body: "json" as const,
  headers: [...GUEST_CHECKOUT_DECLARED_HEADERS],
};
const installedCheckout = createInstalledCheckoutHandlers(resolveRegistryCheckoutServices);
function guestRoute(handler: typeof installedCheckout.prepare) {
  return pluginRoute({ public: true, methods: ["POST"], request: guestRequest, handler });
}
const plugin: SandboxedPlugin = {
  hooks: { cron: installedCheckout.cron },
  routes: {
    [PUBLIC_CATALOG_ROUTE]: pluginRoute({
      public: true,
      methods: ["GET"],
      request: { body: "none" },
      cacheControl: "no-store",
      handler: async (route, ctx) => {
        const query = new URL(route.request.url).searchParams;
        if ([...query.keys()].some(key => key !== "cursor") || query.getAll("cursor").length > 1) throw new Error("Invalid catalog query");
        return readPublicCatalog(ctx, query.get("cursor") ?? undefined);
      },
    }),
    admin: {
      permission: "content:edit_any",
      methods: ["POST"],
      handler: commerceAdmin,
    },
    [GUEST_CHECKOUT_PREPARE_ROUTE]: guestRoute(installedCheckout.prepare),
    [GUEST_CHECKOUT_START_ROUTE]: guestRoute(installedCheckout.start),
    [GUEST_CHECKOUT_STATUS_ROUTE]: guestRoute(installedCheckout.status),
  },
};
export default plugin;
