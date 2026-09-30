import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";
import { commerceAdmin } from "./admin/index.js";
import {
  GUEST_CAPABILITY_HEADER,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  SANDBOX_GUEST_CHECKOUT_STORAGE,
  bindGuestCheckoutRuntime,
  startGuestCheckout,
  statusGuestCheckout,
} from "./features/checkout/kernel/index.js";

const guestRequest = {
  body: "json" as const,
  headers: [GUEST_CAPABILITY_HEADER],
};

const plugin: SandboxedPlugin = {
  routes: {
    admin: {
      permission: "content:edit_any",
      methods: ["POST"],
      handler: commerceAdmin,
    },
    [GUEST_CHECKOUT_START_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: guestRequest,
      handler: async (routeCtx, ctx) =>
        startGuestCheckout(
          bindGuestCheckoutRuntime(ctx.storage as Record<string, unknown>, SANDBOX_GUEST_CHECKOUT_STORAGE, {
            siteUrl: ctx.site?.url,
          }),
          routeCtx.input,
          routeCtx.request.headers,
        ),
    }),
    [GUEST_CHECKOUT_STATUS_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: guestRequest,
      handler: async (routeCtx, ctx) =>
        statusGuestCheckout(
          bindGuestCheckoutRuntime(ctx.storage as Record<string, unknown>, SANDBOX_GUEST_CHECKOUT_STORAGE, {
            siteUrl: ctx.site?.url,
          }),
          routeCtx.input,
          routeCtx.request.headers,
        ),
    }),
  },
};
export default plugin;
