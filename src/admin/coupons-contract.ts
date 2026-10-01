import { COMMERCE_PLUGIN_ID } from "../features/catalog/browser/index.js";

export { COMMERCE_PLUGIN_ID };

export const COUPONS_ADMIN_LIST_ROUTE = "admin/coupons/list";
export const COUPONS_ADMIN_CREATE_ROUTE = "admin/coupons/create";
export const COUPONS_ADMIN_EDIT_ROUTE = "admin/coupons/edit";
export const COUPONS_ADMIN_DISABLE_ROUTE = "admin/coupons/disable";
export const COUPONS_ADMIN_USAGE_ROUTE = "admin/coupons/usage";
export const COUPONS_ADMIN_PERMISSION = "plugins:manage" as const;

export type CouponDiscountForm = "percentage" | "fixed";

export interface CouponBasicForm {
  readonly code: string;
  readonly discountKind: CouponDiscountForm;
  readonly discountValue: string;
  readonly usageLimit: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
}

export interface CouponEditForm extends CouponBasicForm {
  readonly couponId: string;
  readonly expectedRevision: number;
}

export const couponsMenu = Object.freeze({
  path: "/coupons",
  label: "Coupons",
  icon: "tag",
});
