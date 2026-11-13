import type { PaidOrder } from "../handoffs/paid-order.js";

/**
 * Ship takes each text field as one line: every run of whitespace or control characters, line breaks and
 * the Unicode line and paragraph separators included, becomes one space, and the ends are trimmed.
 * Anything not text is left as it is.
 */
export function oneLine<T>(value: T): T {
  return (typeof value === "string" ? value.replace(/[\s\p{Cc}]+/gu, " ").trim() : value) as T;
}

/** One line of at most 200 UTF-16 units, cut without splitting a character. */
export const cut = (text: string) => oneLine(text).slice(0, 200).replace(/[\ud800-\udbff]$/, "").trimEnd();

/**
 * A line's chosen options as the order page shows them, such as "Size: M · Colour: Red", or "" when it has
 * none. The one source for that text: the Orders page, each Ship line and each payment line all use it.
 */
export function lineOptions(order: Pick<PaidOrder, "variantSelections">, catalogItemId: string): string {
  return order.variantSelections?.find(selection => selection.catalogItemId === catalogItemId)?.selections
    .map(choice => choice.optionLabel + ": " + choice.valueLabel).join(" · ") ?? "";
}
