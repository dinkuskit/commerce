import { PluginRouteError, type PluginRoute } from "emdash";
import { loadCheckoutContactRequirements } from "../store-settings/kernel/index.js";

import { COUPONS_COLLECTION, createCheckoutCouponPort, type CouponCollection } from "../coupons/index.js";
import { GuestCheckoutError } from "./errors.js";
import { prepareGuestCheckout, startGuestCheckout, statusGuestCheckout } from "./guest.js";
import { admitBoundGuestCheckoutRuntime, NATIVE_GUEST_CHECKOUT_STORAGE } from "./runtime.js";
import {
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
} from "./route-ids.js";
import {
  GUEST_CHECKOUT_DECLARED_HEADERS,
  type GuestCheckoutHostOptions,
  type GuestCheckoutResult,
} from "./types.js";

export {
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
};

const GUEST_REQUEST = {
  body: "json" as const,
  headers: [...GUEST_CHECKOUT_DECLARED_HEADERS],
};

function nativeRuntime(
  ctx: Parameters<PluginRoute["handler"]>[0],
  options: GuestCheckoutHostOptions,
) {
  const storage = ctx.storage as Record<string, unknown>;
  const coupons = storage[COUPONS_COLLECTION] as CouponCollection | undefined;
  return admitBoundGuestCheckoutRuntime(
    {
      storage,
      request: ctx.request,
      site: ctx.site,
    },
    NATIVE_GUEST_CHECKOUT_STORAGE,
    {
      ...options,
      loadCheckoutContactRequirements: () =>
        loadCheckoutContactRequirements(ctx.settings),
    },
    coupons ? createCheckoutCouponPort(coupons) : undefined,
  );
}

function throwIfDenied(result: GuestCheckoutResult): GuestCheckoutResult {
  if (result.ok) return result;
  throw new PluginRouteError(result.error.code, result.error.message, new GuestCheckoutError(result.error.code).status);
}

async function runNative(
  ctx: Parameters<PluginRoute["handler"]>[0],
  options: GuestCheckoutHostOptions,
  action: (runtime: ReturnType<typeof nativeRuntime>) => Promise<GuestCheckoutResult>,
): Promise<GuestCheckoutResult> {
  try {
    return throwIfDenied(await action(nativeRuntime(ctx, options)));
  } catch (error) {
    if (error instanceof PluginRouteError) throw error;
    if (error instanceof GuestCheckoutError) {
      throw new PluginRouteError(error.code, error.message, error.status);
    }
    throw new PluginRouteError("UNAVAILABLE", new GuestCheckoutError("UNAVAILABLE").message, 503);
  }
}

export function createGuestCheckoutPrepareRoute(
  options: GuestCheckoutHostOptions = {},
): PluginRoute {
  return {
    public: true,
    methods: ["POST"],
    request: GUEST_REQUEST,
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        throw new PluginRouteError("METHOD_NOT_ALLOWED", "guest checkout prepare requires POST", 405);
      }
      return runNative(ctx, options, (runtime) => prepareGuestCheckout(runtime, ctx.input));
    },
  };
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
      return runNative(ctx, options, (runtime) =>
        startGuestCheckout(runtime, ctx.input, ctx.request.headers),
      );
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
      return runNative(ctx, options, (runtime) =>
        statusGuestCheckout(runtime, ctx.input, ctx.request.headers),
      );
    },
  };
}

export const guestCheckoutPrepareRoute: PluginRoute = createGuestCheckoutPrepareRoute();
export const guestCheckoutStartRoute: PluginRoute = createGuestCheckoutStartRoute();
export const guestCheckoutStatusRoute: PluginRoute = createGuestCheckoutStatusRoute();
