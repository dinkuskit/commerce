import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";
import { commerceAdmin } from "./admin/index.js";
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
const plugin: SandboxedPlugin = {
  hooks: { cron: installedCheckout.cron },
  routes: {
    admin: {
      permission: "content:edit_any",
      methods: ["POST"],
      handler: commerceAdmin,
    },
    [GUEST_CHECKOUT_PREPARE_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: guestRequest,
      handler: installedCheckout.prepare,
    }),
    [GUEST_CHECKOUT_START_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: guestRequest,
      handler: installedCheckout.start,
    }),
    [GUEST_CHECKOUT_STATUS_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: guestRequest,
      handler: installedCheckout.status,
    }),
  },
};
export default plugin;
