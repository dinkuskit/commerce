import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

import {
  COMMERCE_PLUGIN_ID,
  COUPONS_ADMIN_CREATE_ROUTE,
  COUPONS_ADMIN_DISABLE_ROUTE,
  COUPONS_ADMIN_EDIT_ROUTE,
  COUPONS_ADMIN_LIST_ROUTE,
} from "./coupons-contract.js";
import type { CouponBasicForm, CouponDiscountForm } from "./coupons-contract.js";

type Coupon = {
  couponId: string;
  code: string;
  revision: number;
  disabled: boolean;
  globalCap: number;
  rule: {
    discount:
      | { kind: "fixed"; amount: { currency: "USD"; minor: string } }
      | { kind: "percentage"; basisPoints: number };
    startsAt: string;
    endsAt: string;
    timeZone: string;
    appliesTo: "all-merchandise" | "selected-products";
    selectedProductIds: readonly string[];
    includeSaleItems: boolean;
    minimumEligibleMerchandise: { currency: "USD"; minor: string };
  };
};

type Counts = {
  cap: number;
  pending: number;
  consumed: number;
  released: number;
  remaining: number;
};

type ListedCoupon = { coupon: Coupon; counts: Counts | null };

const EMPTY_FORM: CouponBasicForm = {
  code: "",
  discountKind: "percentage",
  discountValue: "",
  usageLimit: "",
  startsAt: "",
  endsAt: "",
  timeZone: "",
};

function route(route: string): string {
  return `/_emdash/api/plugins/${COMMERCE_PLUGIN_ID}/${route}`;
}

async function post<T>(routeName: string, body: unknown, fallback: string): Promise<T> {
  const response = await apiFetch(route(routeName), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(response, fallback);
}

function formFromCoupon(coupon: Coupon): CouponBasicForm {
  const discount = coupon.rule.discount;
  return {
    code: coupon.code,
    discountKind: discount.kind,
    discountValue:
      discount.kind === "percentage"
        ? percentageValue(discount.basisPoints)
        : dollarsValue(discount.amount.minor),
    usageLimit: String(coupon.globalCap),
    startsAt: coupon.rule.startsAt,
    endsAt: coupon.rule.endsAt,
    timeZone: coupon.rule.timeZone,
  };
}

function percentageValue(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

function dollarsValue(minor: string): string {
  const value = BigInt(minor);
  const whole = value / 100n;
  const fraction = String(value % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function lifecycle(coupon: Coupon): string {
  if (coupon.disabled) return "Disabled";
  const now = Date.now();
  const starts = Date.parse(coupon.rule.startsAt);
  const ends = Date.parse(coupon.rule.endsAt);
  if (now < starts) return "Upcoming";
  if (now >= ends) return "Expired";
  return "Active";
}

export function CouponsPage() {
  const [listed, setListed] = useState<ListedCoupon[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<CouponBasicForm>(EMPTY_FORM);
  const [revision, setRevision] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const selectedIdRef = useRef<string | null>(null);
  const formRef = useRef<CouponBasicForm>(EMPTY_FORM);
  const selectionGeneration = useRef(0);
  const loadGeneration = useRef(0);

  function selectId(nextId: string | null): void {
    selectedIdRef.current = nextId;
    selectionGeneration.current += 1;
    setSelectedId(nextId);
  }

  async function load(options: {
    targetId?: string | null;
    preserveDraft?: boolean;
    expectedSelectionGeneration?: number;
  } = {}): Promise<void> {
    const requestGeneration = ++loadGeneration.current;
    const requestSelection = options.targetId ?? selectedIdRef.current;
    const requestSelectionGeneration =
      options.expectedSelectionGeneration ?? selectionGeneration.current;
    const result = await post<{ coupons: ListedCoupon[] }>(
      COUPONS_ADMIN_LIST_ROUTE,
      {},
      "Could not load coupons",
    );
    if (requestGeneration !== loadGeneration.current) return;
    setListed(result.coupons);
    if (requestSelectionGeneration !== selectionGeneration.current) {
      return;
    }
    const nextId = requestSelection;
    const next = result.coupons.find((item) => item.coupon.couponId === nextId);
    if (next) {
      selectedIdRef.current = next.coupon.couponId;
      setSelectedId(next.coupon.couponId);
      setRevision(next.coupon.revision);
      if (!options.preserveDraft) {
        const nextForm = formFromCoupon(next.coupon);
        formRef.current = nextForm;
        setForm(nextForm);
      }
    } else if (nextId === null) {
      selectedIdRef.current = null;
      setSelectedId(null);
      setRevision(null);
      if (!options.preserveDraft) {
        formRef.current = EMPTY_FORM;
        setForm(EMPTY_FORM);
      }
    }
    setStale(false);
  }

  async function reloadCurrentKeepingDraft(): Promise<void> {
    const draft = formRef.current;
    const currentId = selectedIdRef.current;
    const currentSelectionGeneration = selectionGeneration.current;
    setPending(true);
    setMessage(null);
    try {
      await load({
        targetId: currentId,
        preserveDraft: true,
        expectedSelectionGeneration: currentSelectionGeneration,
      });
      formRef.current = draft;
      setForm(draft);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reload coupon");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    setPending(true);
    void load().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Could not load coupons");
    }).finally(() => setPending(false));
  }, []);

  function choose(item: ListedCoupon): void {
    if (pending) return;
    selectId(item.coupon.couponId);
    setRevision(item.coupon.revision);
    const nextForm = formFromCoupon(item.coupon);
    formRef.current = nextForm;
    setForm(nextForm);
    setMessage(null);
  }

  function update(name: keyof CouponBasicForm, value: string): void {
    setForm((current) => {
      const next = { ...current, [name]: value };
      formRef.current = next;
      return next;
    });
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setStale(false);
    try {
      if (selectedId === null) {
        const created = await post<{ coupon: Coupon }>(
          COUPONS_ADMIN_CREATE_ROUTE,
          form,
          "Could not create coupon",
        );
        await load({ targetId: created.coupon.couponId });
      } else if (revision !== null) {
        const edited = await post<{ coupon: Coupon }>(
          COUPONS_ADMIN_EDIT_ROUTE,
          { ...form, couponId: selectedId, expectedRevision: revision },
          "Could not save coupon",
        );
        await load({ targetId: edited.coupon.couponId });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save coupon");
      setStale(error instanceof Error && /revision|expected/i.test(error.message));
    } finally {
      setPending(false);
    }
  }

  async function disable(): Promise<void> {
    if (selectedId === null || revision === null) return;
    if (typeof window !== "undefined" && !window.confirm("Disable this coupon?")) return;
    setPending(true);
    setMessage(null);
    setStale(false);
    try {
      const disabled = await post<{ coupon: Coupon }>(
        COUPONS_ADMIN_DISABLE_ROUTE,
        { couponId: selectedId, expectedRevision: revision },
        "Could not disable coupon",
      );
      await load({ targetId: disabled.coupon.couponId });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable coupon");
      setStale(error instanceof Error && /revision|expected/i.test(error.message));
    } finally {
      setPending(false);
    }
  }

  return createElement(
    "section",
    { "aria-labelledby": "coupons-title", style: { display: "grid", gap: "1.5rem", maxWidth: "72rem", width: "100%" } },
    createElement("h1", { id: "coupons-title", style: { fontSize: "1.5rem", margin: 0 } }, "Coupons"),
    message === null
      ? null
      : createElement("p", { role: "alert", style: { color: "var(--kumo-danger, #b42318)", margin: 0 } }, message),
    createElement(
      "div",
      { style: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "1.5rem", width: "100%" } },
      createElement(
        "section",
        { "aria-labelledby": "coupon-list-title", style: { flex: "1 1 15rem", minWidth: "15rem" } },
        createElement("h2", { id: "coupon-list-title", style: { fontSize: "1.125rem", margin: "0 0 0.75rem" } }, "Existing coupons"),
        listed.length === 0
          ? createElement("p", { style: { margin: "0 0 1rem" } }, "No coupons yet.")
          : createElement(
              "ul",
              { "aria-label": "Existing coupons", style: { display: "grid", gap: "0.5rem", listStyle: "none", margin: "0 0 1rem", padding: 0 } },
              ...listed.map((item) =>
                createElement(
                  "li",
                  { key: item.coupon.couponId },
                  createElement(
                    "button",
                    {
                      type: "button",
                      disabled: pending,
                      onClick: () => choose(item),
                      "aria-current": item.coupon.couponId === selectedId ? "true" : undefined,
                      style: buttonStyle(item.coupon.couponId === selectedId),
                    },
                    `${item.coupon.code} — ${lifecycle(item.coupon)}`,
                  ),
                ),
              ),
            ),
        createElement(
          "button",
          {
            type: "button",
            disabled: pending,
            onClick: () => {
              selectId(null);
              setRevision(null);
              formRef.current = EMPTY_FORM;
              setForm(EMPTY_FORM);
              setMessage(null);
            },
            style: buttonStyle(false),
          },
          "Create coupon",
        ),
      ),
      createElement(
        "form",
        { onSubmit: (event: FormEvent) => void save(event), style: { display: "grid", gap: "0.75rem", flex: "2 1 30rem", minWidth: 0 } },
        createElement(
          "h2",
          { style: { fontSize: "1.125rem", margin: 0 } },
          selectedId === null ? "Create coupon" : "Edit coupon",
        ),
        field("Code", "coupon-code", form.code, (value) => update("code", value), pending),
        selectField("Discount", "coupon-discount-kind", form.discountKind, [
          ["percentage", "Percentage"],
          ["fixed", "Fixed amount (USD)"],
        ], (value) => update("discountKind", value as CouponDiscountForm), pending),
        field(
          form.discountKind === "percentage" ? "Percentage (0–100%, up to 2 decimals)" : "Amount in USD",
          "coupon-discount-value",
          form.discountValue,
          (value) => update("discountValue", value),
          pending,
        ),
        field("Usage limit", "coupon-usage-limit", form.usageLimit, (value) => update("usageLimit", value), pending),
        field("Starts at (ISO offset)", "coupon-starts-at", form.startsAt, (value) => update("startsAt", value), pending),
        field("Ends at (ISO offset, exclusive)", "coupon-ends-at", form.endsAt, (value) => update("endsAt", value), pending),
        field("Merchant timezone (IANA)", "coupon-time-zone", form.timeZone, (value) => update("timeZone", value), pending),
        createElement(
          "p",
          { style: { fontSize: "0.875rem", lineHeight: 1.4, margin: 0 } },
          "Dates require an explicit offset, for example 2026-10-01T09:00:00-04:00. Start is inclusive; end is exclusive.",
        ),
        stale
          ? createElement(
              "button",
              { type: "button", disabled: pending, onClick: () => void reloadCurrentKeepingDraft(), style: buttonStyle(false) },
              "Reload current and keep draft",
            )
          : null,
        createElement("button", { type: "submit", disabled: pending, style: buttonStyle(false) }, selectedId === null ? "Create" : "Save"),
        selectedId === null || listed.find((item) => item.coupon.couponId === selectedId)?.coupon.disabled
          ? null
          : createElement("button", { type: "button", disabled: pending, onClick: () => void disable(), style: buttonStyle(false) }, "Disable"),
        selectedId === null
          ? null
          : createElement(
              "section",
              { "aria-labelledby": "coupon-usage-title", style: { borderTop: "1px solid currentColor", marginTop: "1rem", paddingTop: "1rem" } },
              createElement("h3", { id: "coupon-usage-title", style: { fontSize: "1rem", margin: "0 0 0.75rem" } }, "Usage"),
              usageSummary(listed.find((item) => item.coupon.couponId === selectedId)?.counts ?? null),
            ),
      ),
    ),
  );
}

function buttonStyle(selected: boolean): Record<string, string> {
  return {
    appearance: "none",
    background: selected ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
    border: "1px solid currentColor",
    borderRadius: "0.35rem",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    lineHeight: "1.3",
    padding: "0.55rem 0.8rem",
  };
}

function field(
  label: string,
  id: string,
  value: string,
  setValue: (value: string) => void,
  disabled: boolean,
) {
  return createElement(
    "label",
    { htmlFor: id, style: { display: "grid", gap: "0.3rem", minWidth: 0 } },
    createElement("span", null, label),
    createElement("input", {
      id,
      value,
      required: true,
      disabled,
      style: inputStyle,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.currentTarget.value),
    }),
  );
}

function selectField(
  label: string,
  id: string,
  value: string,
  options: readonly (readonly [string, string])[],
  setValue: (value: string) => void,
  disabled: boolean,
) {
  return createElement(
    "label",
    { htmlFor: id, style: { display: "grid", gap: "0.3rem", minWidth: 0 } },
    createElement("span", null, label),
    createElement(
      "select",
      {
        id,
        value,
        disabled,
        style: inputStyle,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => setValue(event.currentTarget.value),
      },
      ...options.map(([option, text]) => createElement("option", { key: option, value: option }, text)),
    ),
  );
}

function usageSummary(counts: Counts | null) {
  if (counts === null) return createElement("p", null, "Usage unavailable.");
  return createElement(
    "dl",
    { "aria-label": "Coupon usage", style: { display: "grid", gridTemplateColumns: "1fr auto", gap: "0.45rem 1rem", margin: 0 } },
    createElement("dt", null, "Consumed redemptions"),
    createElement("dd", { style: { fontVariantNumeric: "tabular-nums", margin: 0 } }, counts.consumed),
    createElement("dt", null, "Pending holds"),
    createElement("dd", { style: { fontVariantNumeric: "tabular-nums", margin: 0 } }, counts.pending),
    createElement("dt", null, "Released attempts"),
    createElement("dd", { style: { fontVariantNumeric: "tabular-nums", margin: 0 } }, counts.released),
    createElement("dt", null, "Remaining capacity"),
    createElement("dd", { style: { fontVariantNumeric: "tabular-nums", margin: 0 } }, counts.remaining),
  );
}

const inputStyle = {
  background: "transparent",
  border: "1px solid currentColor",
  borderRadius: "0.35rem",
  boxSizing: "border-box" as const,
  color: "inherit",
  font: "inherit",
  minHeight: "2.5rem",
  padding: "0.55rem 0.65rem",
  width: "100%",
};
