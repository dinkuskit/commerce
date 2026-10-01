import { PluginRouteError, type PluginRoute } from "emdash";

import {
  CouponAdminError,
  type CouponCollection,
  type CouponRecord,
} from "../features/coupons/index.js";
import {
  COUPONS_ADMIN_CREATE_ROUTE,
  COUPONS_ADMIN_DISABLE_ROUTE,
  COUPONS_ADMIN_EDIT_ROUTE,
  COUPONS_ADMIN_LIST_ROUTE,
  COUPONS_ADMIN_PERMISSION,
  COUPONS_ADMIN_USAGE_ROUTE,
} from "./coupons-contract.js";
import {
  couponUsage,
  createCoupon,
  createCouponAdminPorts,
  disableCoupon,
  editCoupon,
  listCoupons,
  type CouponAdminPorts,
  type CouponBasicForm,
  type CouponEditForm,
} from "./coupons-controller.js";

export {
  COUPONS_ADMIN_CREATE_ROUTE,
  COUPONS_ADMIN_DISABLE_ROUTE,
  COUPONS_ADMIN_EDIT_ROUTE,
  COUPONS_ADMIN_LIST_ROUTE,
  COUPONS_ADMIN_PERMISSION,
  COUPONS_ADMIN_USAGE_ROUTE,
} from "./coupons-contract.js";

export interface CouponAdminRouteStorage {
  readonly coupons: CouponCollection;
}

export interface CouponAdminRouteContext {
  readonly storage: CouponAdminRouteStorage;
}

export type CouponAdminRouteStorageResolver = (
  ctx: { readonly storage: Record<string, unknown> },
) => CouponAdminRouteStorage;

function routeError(error: unknown): never {
  if (error instanceof CouponAdminError) {
    const status =
      error.code === "INVALID_INPUT"
        ? 400
        : error.code === "NOT_FOUND"
          ? 404
          : error.code === "REVISION_CONFLICT"
            ? 409
            : 503;
    throw new PluginRouteError(error.code, error.message, status);
  }
  throw error;
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginRouteError("INVALID_INPUT", "request input must be an object", 400);
  }
  return value as Record<string, unknown>;
}

function ports(resolve: CouponAdminRouteStorageResolver, ctx: Parameters<PluginRoute["handler"]>[0]): CouponAdminPorts {
  return createCouponAdminPorts(resolve(ctx));
}

function method(ctx: Parameters<PluginRoute["handler"]>[0], expected: string): void {
  if (ctx.request.method.toUpperCase() !== expected) {
    throw new PluginRouteError(
      "METHOD_NOT_ALLOWED",
      `coupon admin route requires ${expected}`,
      405,
    );
  }
}

function makeRoute(
  resolve: CouponAdminRouteStorageResolver,
  handler: (ports: CouponAdminPorts, input: Record<string, unknown>) => Promise<unknown>,
  expectedMethod = "POST",
): PluginRoute {
  return {
    permission: COUPONS_ADMIN_PERMISSION,
    handler: async (ctx) => {
      method(ctx, expectedMethod);
      try {
        return await handler(ports(resolve, ctx), inputRecord(ctx.input));
      } catch (error) {
        routeError(error);
      }
    },
  };
}

export function createCouponAdminRoutes(
  resolve: CouponAdminRouteStorageResolver,
): Readonly<Record<
  | typeof COUPONS_ADMIN_LIST_ROUTE
  | typeof COUPONS_ADMIN_CREATE_ROUTE
  | typeof COUPONS_ADMIN_EDIT_ROUTE
  | typeof COUPONS_ADMIN_DISABLE_ROUTE
  | typeof COUPONS_ADMIN_USAGE_ROUTE,
  PluginRoute
>> {
  return Object.freeze({
    [COUPONS_ADMIN_LIST_ROUTE]: makeRoute(resolve, async (owner) => ({
      coupons: await listCoupons(owner),
    })),
    [COUPONS_ADMIN_CREATE_ROUTE]: makeRoute(resolve, async (owner, input) => ({
      coupon: await createCoupon(owner, input as unknown as CouponBasicForm),
    })),
    [COUPONS_ADMIN_EDIT_ROUTE]: makeRoute(resolve, async (owner, input) => ({
      coupon: await editCoupon(owner, input as unknown as CouponEditForm),
    })),
    [COUPONS_ADMIN_DISABLE_ROUTE]: makeRoute(resolve, async (owner, input) => ({
      coupon: await disableCoupon(
        owner,
        input.couponId,
        input.expectedRevision,
      ),
    })),
    [COUPONS_ADMIN_USAGE_ROUTE]: makeRoute(resolve, async (owner, input) => ({
      counts: await couponUsage(owner, input.couponId),
    })),
  });
}

export const couponAdminRouteContract = Object.freeze({
  permission: COUPONS_ADMIN_PERMISSION,
  storage: Object.freeze({
    collection: "coupons",
    indexes: ["normalizedCode"],
    uniqueIndexes: ["normalizedCode"],
  }),
  routes: Object.freeze([
    COUPONS_ADMIN_LIST_ROUTE,
    COUPONS_ADMIN_CREATE_ROUTE,
    COUPONS_ADMIN_EDIT_ROUTE,
    COUPONS_ADMIN_DISABLE_ROUTE,
    COUPONS_ADMIN_USAGE_ROUTE,
  ]),
  mounted: false,
});

export type CouponAdminRouteResponse = {
  readonly coupon: CouponRecord;
};
