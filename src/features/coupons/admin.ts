import { normalizeMoney, parseMinorUnits, type Money } from "../catalog/index.js";
import type { PluginRoute } from "emdash";
import {
  COUPONS_COLLECTION,
  type CouponAdminPort,
  type CouponCollection,
  type CouponDiscount,
  type CouponRecord,
  type CouponRule,
} from "./types.js";
import { CouponRecordValidationError, validateCouponRecord } from "./validation.js";

export class CouponAdminError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "STORAGE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "CouponAdminError";
  }
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

const CODE_PATTERN = /^[^\s]+(?:\s+[^\s]+)*$/;
const TIME_ZONE_PATTERN = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/;

export function normalizeCouponCode(value: unknown): string {
  if (typeof value !== "string" || !CODE_PATTERN.test(value.trim())) {
    throw new CouponAdminError("INVALID_INPUT", "code must contain non-whitespace text");
  }
  return value.trim().toLocaleUpperCase("en-US");
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CouponAdminError("INVALID_INPUT", `${name} must be non-empty`);
  }
  return value.trim();
}

function safeInteger(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new CouponAdminError("INVALID_INPUT", `${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

export function normalizeCouponInstant(value: unknown, name: string): string {
  const text = nonEmpty(value, name);
  if (!/T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new CouponAdminError("INVALID_INPUT", `${name} must include an explicit UTC offset`);
  }
  const datePart = /^(\d{4})-(\d{2})-(\d{2})T/.exec(text);
  if (!datePart || Number(datePart[2]) < 1 || Number(datePart[2]) > 12 ||
      Number(datePart[3]) < 1 ||
      Number(datePart[3]) > new Date(Date.UTC(Number(datePart[1]), Number(datePart[2]), 0)).getUTCDate()) {
    throw new CouponAdminError("INVALID_INPUT", `${name} must contain a real calendar date`);
  }
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) {
    throw new CouponAdminError("INVALID_INPUT", `${name} must be a canonical ISO instant`);
  }
  return date.toISOString();
}

function timeZone(value: unknown): string {
  const zone = nonEmpty(value, "timeZone");
  if (!TIME_ZONE_PATTERN.test(zone)) {
    throw new CouponAdminError("INVALID_INPUT", "timeZone must be an explicit IANA zone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
  } catch {
    throw new CouponAdminError("INVALID_INPUT", "timeZone must be a valid IANA zone");
  }
  return zone;
}

function money(value: unknown, name: string): Money {
  try {
    return normalizeMoney(value, name);
  } catch (error) {
    throw new CouponAdminError("INVALID_INPUT", error instanceof Error ? error.message : `${name} is invalid`);
  }
}

function discount(value: unknown): CouponDiscount {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CouponAdminError("INVALID_INPUT", "discount must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.kind === "fixed") {
    return { kind: "fixed", amount: money(input.amount, "discount.amount") };
  }
  if (input.kind === "percentage") {
    const basisPoints = safeInteger(input.basisPoints, "discount.basisPoints");
    if (basisPoints > 10000) {
      throw new CouponAdminError("INVALID_INPUT", "percentage cannot exceed 100%");
    }
    return {
      kind: "percentage",
      basisPoints,
      ...(input.maximum === undefined ? {} : { maximum: money(input.maximum, "discount.maximum") }),
    };
  }
  throw new CouponAdminError("INVALID_INPUT", "discount.kind must be fixed or percentage");
}

export function normalizeCouponRule(value: unknown, version: number = 1): CouponRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CouponAdminError("INVALID_INPUT", "rule must be an object");
  }
  const input = value as Record<string, unknown>;
  safeInteger(version, "version", 1);

  const appliesTo = input.appliesTo;
  if (appliesTo !== "all-merchandise" && appliesTo !== "selected-products") {
    throw new CouponAdminError("INVALID_INPUT", "rule.appliesTo is invalid");
  }
  const selected = input.selectedProductIds === undefined ? [] : input.selectedProductIds;
  if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new CouponAdminError("INVALID_INPUT", "selectedProductIds must be string IDs");
  }
  if (appliesTo === "selected-products" && selected.length === 0) {
    throw new CouponAdminError("INVALID_INPUT", "selected-products requires product IDs");
  }
  if (input.includeSaleItems !== undefined && typeof input.includeSaleItems !== "boolean") {
    throw new CouponAdminError("INVALID_INPUT", "includeSaleItems must be a boolean");
  }
  const startsAt = normalizeCouponInstant(input.startsAt, "startsAt");
  const endsAt = normalizeCouponInstant(input.endsAt, "endsAt");
  if (startsAt >= endsAt) {
    throw new CouponAdminError("INVALID_INPUT", "startsAt must be before endsAt");
  }
  const minimumEligibleMerchandise = money(input.minimumEligibleMerchandise, "minimumEligibleMerchandise");
  return deepFreeze({
    ruleId: nonEmpty(input.ruleId ?? crypto.randomUUID(), "ruleId"),
    version,
    discount: discount(input.discount),
    appliesTo,
    selectedProductIds: Object.freeze([...new Set(selected.map((id) => id.trim()))]),
    includeSaleItems: input.includeSaleItems === true,
    minimumEligibleMerchandise,
    startsAt,
    endsAt,
    timeZone: timeZone(input.timeZone),
  });
}

function createRecord(input: unknown): CouponRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CouponAdminError("INVALID_INPUT", "coupon input must be an object");
  }
  const value = input as Record<string, unknown>;
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
    throw new CouponAdminError("INVALID_INPUT", "disabled must be a boolean");
  }
  const now = new Date().toISOString();
  return deepFreeze({
    recordKind: "coupon",
    couponId: crypto.randomUUID(),
    code: nonEmpty(value.code, "code").trim(),
    normalizedCode: normalizeCouponCode(value.code),
    revision: 1,
    disabled: value.disabled === true,
    globalCap: safeInteger(value.globalCap, "globalCap"),
    rule: normalizeCouponRule(value.rule, 1),
    createdAt: now,
    updatedAt: now,
    attempts: Object.freeze([]),
  });
}

function assertCoupon(value: unknown, id: string): CouponRecord {
  try {
    return deepFreeze(validateCouponRecord(value, id));
  } catch (error) {
    if (error instanceof CouponRecordValidationError) {
      throw new CouponAdminError("STORAGE_UNAVAILABLE", error.message);
    }
    throw error;
  }
}

export function createCouponAdmin(collection: CouponCollection): CouponAdminPort {
  return {
    async create(input) {
      const record = createRecord(input);
      try {
        await collection.put(record.couponId, record);
      } catch (error) {
        throw new CouponAdminError("STORAGE_UNAVAILABLE", "coupon create failed; normalized-code uniqueness is storage-enforced");
      }
      return deepFreeze(record);
    },
    async list() {
      const rows: CouponRecord[] = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      while (true) {
        const result = await collection.query({ limit: 100, cursor });
        rows.push(...result.items.map((item) => assertCoupon(item.data, item.id)));
        if (!result.hasMore) return deepFreeze(rows);
        if (!result.cursor || result.cursor === cursor || seenCursors.has(result.cursor)) {
          throw new CouponAdminError("STORAGE_UNAVAILABLE", "coupon pagination cursor did not advance");
        }
        seenCursors.add(result.cursor);
        cursor = result.cursor;
      }
    },
    async get(couponId) {
      const id = nonEmpty(couponId, "couponId");
      const record = await collection.get(id);
      return record === null ? null : deepFreeze(assertCoupon(record, id));
    },
    async findByCode(code) {
      const normalized = normalizeCouponCode(code);
      const result = await collection.query({ where: { normalizedCode: normalized }, limit: 2 });
      const match = result.items.find((item) => item.data.normalizedCode === normalized);
      return match ? deepFreeze(assertCoupon(match.data, match.id)) : null;
    },
    async edit(couponId, expectedRevision, input) {
      const id = nonEmpty(couponId, "couponId");
      safeInteger(expectedRevision, "expectedRevision", 1);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new CouponAdminError("INVALID_INPUT", "edit input must be an object");
      }
      const value = input as Record<string, unknown>;
      if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
        throw new CouponAdminError("INVALID_INPUT", "disabled must be a boolean");
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const stored = await collection.getVersioned(id);
        if (!stored) throw new CouponAdminError("NOT_FOUND", "coupon was not found");
        const current = assertCoupon(stored.value, id);
        if (current.revision !== expectedRevision) {
          throw new CouponAdminError("REVISION_CONFLICT", "coupon revision does not match expectedRevision");
        }
        const nextRule = value.rule === undefined
          ? current.rule
          : normalizeCouponRule(value.rule, current.rule.version + 1);
        const next: CouponRecord = deepFreeze({
          ...current,
          ...(value.code === undefined ? {} : {
            code: nonEmpty(value.code, "code"),
            normalizedCode: normalizeCouponCode(value.code),
          }),
          ...(value.globalCap === undefined ? {} : { globalCap: safeInteger(value.globalCap, "globalCap") }),
          ...(value.disabled === undefined ? {} : { disabled: value.disabled }),
          rule: nextRule,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        try {
          if ((await collection.compareAndSet(id, stored.revision, next)).applied) return deepFreeze(next);
        } catch (error) {
          throw new CouponAdminError("STORAGE_UNAVAILABLE", "coupon edit failed; normalized-code uniqueness is storage-enforced");
        }
      }
      throw new CouponAdminError("REVISION_CONFLICT", "coupon edit contention did not settle");
    },
    async disable(couponId, expectedRevision) {
      return this.edit(couponId, expectedRevision, { disabled: true });
    },
  };
}

export const couponStorageDeclaration = Object.freeze({
  collection: COUPONS_COLLECTION,
  indexes: ["normalizedCode"],
  uniqueIndexes: ["normalizedCode"],
  requiredPermission: "plugins:manage" satisfies NonNullable<PluginRoute["permission"]>,
  mounted: false,
});

export { parseMinorUnits };
