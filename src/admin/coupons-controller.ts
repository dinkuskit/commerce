import {
  createCouponAdmin,
  createCouponAttemptOwner,
  type CouponAdminPort,
  type CouponAttemptPort,
  type CouponCollection,
  type CouponRecord,
} from "../features/coupons/index.js";
import { CouponAdminError } from "../features/coupons/index.js";
import type {
  CouponBasicForm,
  CouponDiscountForm,
  CouponEditForm,
} from "./coupons-contract.js";

export type CouponAdminCollections = {
  readonly coupons: CouponCollection;
};

export type CouponAdminPorts = {
  readonly admin: CouponAdminPort;
  readonly attempts: CouponAttemptPort;
};

export type { CouponBasicForm, CouponDiscountForm, CouponEditForm } from "./coupons-contract.js";

export function createCouponAdminPorts(
  collections: CouponAdminCollections,
): CouponAdminPorts {
  return {
    admin: createCouponAdmin(collections.coupons),
    attempts: createCouponAttemptOwner(collections.coupons),
  };
}

function invalid(message: string): never {
  throw new CouponAdminError("INVALID_INPUT", message);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") invalid(`${name} must be text`);
  return value;
}

function whole(value: unknown, name: string): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value.trim())) {
    invalid(`${name} must be a whole number`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value.trim());
  } catch {
    invalid(`${name} is too large`);
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) invalid(`${name} is too large`);
  return Number(parsed);
}

function decimal(value: unknown, name: string): { whole: bigint; fraction: string } {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) {
    invalid(`${name} bad decimal`);
  }
  const [wholePart, fraction = ""] = value.trim().split(".");
  return { whole: BigInt(wholePart), fraction: fraction.padEnd(2, "0") };
}

function dollars(value: unknown, name: string): { currency: "USD"; minor: string } {
  const parsed = decimal(value, name);
  return {
    currency: "USD",
    minor: (parsed.whole * 100n + BigInt(parsed.fraction)).toString(),
  };
}

function percentage(value: unknown): number {
  const parsed = decimal(value, "percentage");
  const basisPoints = parsed.whole * 100n + BigInt(parsed.fraction);
  if (basisPoints > 10000n) invalid("percentage cannot exceed 100%");
  return Number(basisPoints);
}

function form(value: unknown, name = "form"): CouponBasicForm {
  const input = record(value, name);
  const fields = ["code", "discountKind", "discountValue", "usageLimit", "startsAt", "endsAt", "timeZone"];
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid(`${name} has unsupported fields`);
  for (const field of fields) text(input[field], `${name}.${field}`);
  if (input.discountKind !== "percentage" && input.discountKind !== "fixed") {
    invalid("discountKind must be percentage or fixed");
  }
  return input as unknown as CouponBasicForm;
}

function discount(formValue: CouponBasicForm, existing: CouponRecord["rule"] | undefined) {
  if (formValue.discountKind === "percentage") {
    const maximum = existing?.discount.kind === "percentage" ? existing.discount.maximum : undefined;
    return {
      kind: "percentage" as const,
      basisPoints: percentage(formValue.discountValue),
      ...(maximum === undefined ? {} : { maximum }),
    };
  }
  return { kind: "fixed" as const, amount: dollars(formValue.discountValue, "amount") };
}

function rule(formValue: CouponBasicForm, existing: CouponRecord["rule"] | undefined) {
  return {
    ...(existing ?? {
      ruleId: crypto.randomUUID(),
      version: 1,
      appliesTo: "all-merchandise" as const,
      selectedProductIds: [],
      includeSaleItems: false,
      minimumEligibleMerchandise: { currency: "USD" as const, minor: "0" },
    }),
    discount: discount(formValue, existing),
    startsAt: formValue.startsAt.trim(),
    endsAt: formValue.endsAt.trim(),
    timeZone: formValue.timeZone.trim(),
  };
}

export function couponCreateInput(form: CouponBasicForm): unknown {
  const valid = formInput(form);
  return {
    code: valid.code,
    globalCap: whole(valid.usageLimit, "usage limit"),
    rule: rule(valid, undefined),
  };
}

export function couponEditInput(
  formValue: CouponEditForm,
  current: CouponRecord,
): unknown {
  const valid = editInput(formValue);
  return {
    code: valid.code,
    globalCap: whole(valid.usageLimit, "usage limit"),
    rule: rule(valid, current.rule),
  };
}

function formInput(value: unknown): CouponBasicForm {
  return form(value);
}

function editInput(value: unknown): CouponEditForm {
  const input = record(value, "edit input");
  if (typeof input.couponId !== "string" || input.couponId.trim() === "") invalid("couponId must be non-empty text");
  if (typeof input.expectedRevision !== "number" ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    invalid("expectedRevision must be a safe integer >= 1");
  }
  const { couponId, expectedRevision, ...basic } = input;
  return { ...form(basic), couponId, expectedRevision } as CouponEditForm;
}

export async function listCoupons(ports: CouponAdminPorts) {
  const coupons = await ports.admin.list();
  const usage = await Promise.all(
    coupons.map(async (coupon) => ({
      couponId: coupon.couponId,
      counts: await ports.attempts.getCounts(coupon.couponId),
    })),
  );
  const counts = new Map(usage.map((item) => [item.couponId, item.counts]));
  return coupons.map((coupon) => ({ coupon, counts: counts.get(coupon.couponId) ?? null }));
}

export async function createCoupon(
  ports: CouponAdminPorts,
  formValue: CouponBasicForm,
) {
  return ports.admin.create(couponCreateInput(formInput(formValue)));
}

export async function editCoupon(
  ports: CouponAdminPorts,
  formValue: CouponEditForm,
) {
  const valid = editInput(formValue);
  const current = await ports.admin.get(valid.couponId);
  if (!current) throw new CouponAdminError("NOT_FOUND", "coupon was not found");
  return ports.admin.edit(
    valid.couponId,
    valid.expectedRevision,
    couponEditInput(valid, current),
  );
}

export async function disableCoupon(
  ports: CouponAdminPorts,
  couponId: unknown,
  expectedRevision: unknown,
) {
  if (typeof couponId !== "string" || couponId.trim() === "") invalid("couponId must be non-empty text");
  if (typeof expectedRevision !== "number" ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    invalid("expectedRevision must be a safe integer >= 1");
  }
  return ports.admin.disable(couponId, expectedRevision);
}

export async function couponUsage(ports: CouponAdminPorts, couponId: unknown) {
  if (typeof couponId !== "string" || couponId.trim() === "") invalid("couponId must be non-empty text");
  return ports.attempts.getCounts(couponId);
}
