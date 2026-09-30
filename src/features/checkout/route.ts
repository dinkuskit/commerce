import { PluginRouteError, type PluginRoute } from "emdash";

import { GuestCheckoutError } from "./errors.js";
import { startGuestCheckout, statusGuestCheckout } from "./guest.js";
import { bindGuestCheckoutRuntime, NATIVE_GUEST_CHECKOUT_STORAGE } from "./runtime.js";
import {
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
} from "./route-ids.js";
import { GUEST_CAPABILITY_HEADER, type GuestCheckoutHostOptions, type GuestCheckoutResult } from "./types.js";

export { GUEST_CHECKOUT_START_ROUTE, GUEST_CHECKOUT_STATUS_ROUTE };

const GUEST_REQUEST = {
  body: "json" as const,
  headers: [GUEST_CAPABILITY_HEADER],
};

function nativeRuntime(
  ctx: Parameters<PluginRoute["handler"]>[0],
  options: GuestCheckoutHostOptions,
) {
  return bindGuestCheckoutRuntime(ctx.storage as Record<string, unknown>, NATIVE_GUEST_CHECKOUT_STORAGE, {
    siteUrl: ctx.site?.url,
    host: options,
  });
}

function throwIfDenied(result: GuestCheckoutResult): GuestCheckoutResult {
  if (result.ok) return result;
  throw new PluginRouteError(result.error.code, result.error.message, new GuestCheckoutError(result.error.code).status);
}

export function createGuestCheckoutStartRoute(
  options: GuestCheckoutHostOptions = {},
): PluginRoute {
  return {
    public: true,
    methods: ["POST"],
    request: GUEST_REQUEST,
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        throw new PluginRouteError("METHOD_NOT_ALLOWED", "guest checkout start requires POST", 405);
      }
      return throwIfDenied(await startGuestCheckout(nativeRuntime(ctx, options), ctx.input, ctx.request.headers));
    },
  };
}

export function createGuestCheckoutStatusRoute(
  options: GuestCheckoutHostOptions = {},
): PluginRoute {
  return {
    public: true,
    methods: ["POST"],
    request: GUEST_REQUEST,
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        throw new PluginRouteError("METHOD_NOT_ALLOWED", "guest checkout status requires POST", 405);
      }
      return throwIfDenied(await statusGuestCheckout(nativeRuntime(ctx, options), ctx.input, ctx.request.headers));
    },
  };
}

export const guestCheckoutStartRoute: PluginRoute = createGuestCheckoutStartRoute();
export const guestCheckoutStatusRoute: PluginRoute = createGuestCheckoutStatusRoute();
