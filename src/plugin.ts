import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";
import { commerceAdmin } from "./admin/index.js";
import {
  GUEST_CHECKOUT_DECLARED_HEADERS,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  SANDBOX_GUEST_CHECKOUT_STORAGE,
  GuestCheckoutError,
  admitBoundGuestCheckoutRuntime,
  guestCheckoutFailure,
  prepareGuestCheckout,
  startGuestCheckout,
  statusGuestCheckout,
} from "./features/checkout/kernel/index.js";

const guestRequest = {
  body: "json" as const,
  headers: [...GUEST_CHECKOUT_DECLARED_HEADERS],
};

async function sandboxGuest<T>(
  routeCtx: { input: unknown; request: { url: string; headers?: Record<string, string> } },
  ctx: { storage: Record<string, unknown>; site?: { url?: string } },
  action: (runtime: ReturnType<typeof admitBoundGuestCheckoutRuntime>) => Promise<T>,
): Promise<T | ReturnType<typeof guestCheckoutFailure>> {
  try {
    return await action(
      admitBoundGuestCheckoutRuntime(
        {
          storage: ctx.storage,
          request: routeCtx.request,
          site: ctx.site,
        },
        SANDBOX_GUEST_CHECKOUT_STORAGE,
      ),
    );
  } catch (error) {
    if (error instanceof GuestCheckoutError) return guestCheckoutFailure(error.code);
    return guestCheckoutFailure("UNAVAILABLE");
  }
}

const plugin: SandboxedPlugin = {
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
      handler: async (routeCtx, ctx) =>
        sandboxGuest(routeCtx, ctx, (runtime) => prepareGuestCheckout(runtime)),
    }),
    [GUEST_CHECKOUT_START_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: guestRequest,
      handler: async (routeCtx, ctx) =>
        sandboxGuest(routeCtx, ctx, (runtime) =>
          startGuestCheckout(runtime, routeCtx.input, routeCtx.request.headers),
        ),
    }),
    [GUEST_CHECKOUT_STATUS_ROUTE]: pluginRoute({
      public: true,
      methods: ["POST"],
      request: guestRequest,
      handler: async (routeCtx, ctx) =>
        sandboxGuest(routeCtx, ctx, (runtime) =>
          statusGuestCheckout(runtime, routeCtx.input, routeCtx.request.headers),
        ),
    }),
  },
};
export default plugin;
