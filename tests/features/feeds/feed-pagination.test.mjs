import assert from "node:assert/strict";
import test from "node:test";
import { pageProductFeedRows } from "../../../dist/features/feeds/index.js";

function products(length) {
  return Object.freeze(Array.from({ length }, (_, index) => Object.freeze({
    product: Object.freeze({
      id: `item-${index}`,
      name: `Product ${index}`,
      sku: `SKU-${index}`,
      price: Object.freeze({ currency: "USD", minor: "100" }),
      availability: Object.freeze({ status: "in-stock", sellable: true, listable: true }),
      image: null,
      gallery: Object.freeze([]),
    }),
    content: Object.freeze({ canonicalUrl: `https://shop.example.test/products/item-${index}`, title: `Product ${index}` }),
    eligibility: Object.freeze(["google-merchant", "meta-catalog"]),
  })));
}

const invalidCases = [
  { name: "empty input", length: 0, cursor: 0 },
  { name: "initial page", length: 3, cursor: 0 },
  { name: "continuation", length: 3, cursor: 1 },
  { name: "terminal cursor", length: 3, cursor: 3 },
  { name: "cursor beyond the input", length: 3, cursor: 99 },
];
for (const { name, length, cursor } of invalidCases) {
  test(`NaN feed page size rejects at ${name} rather than stalling or silently terminating`, () => {
    const rows = products(length);
    for (const pageSize of [NaN, Number.parseInt("not-a-page-size", 10)]) {
      assert.throws(() => pageProductFeedRows(rows, Object.freeze({ pageSize, cursor })), {
        name: "RangeError", message: "invalid feed page size",
      });
    }
  });
}

const sizes = [
  [undefined, 100], [1, 1], [2, 2], [1.9, 1], [100, 100], [500, 500],
  [9999, 500], [0, 1], [-3, 1], [Infinity, 500], [-Infinity, 1],
];
for (const [pageSize, expectedSize] of sizes) {
  test(`feed traversal preserves bounds, order and progress for pageSize ${String(pageSize)}`, () => {
    const rows = products(503);
    const seen = [];
    let cursor = 0;
    for (let step = 0; step <= rows.length; step++) {
      const page = pageProductFeedRows(rows, Object.freeze({ pageSize, cursor }));
      assert.deepEqual(page.rows, rows.slice(cursor, cursor + expectedSize));
      assert.ok(page.rows.length > 0 && page.rows.length <= 500);
      for (const [index, row] of page.rows.entries()) assert.equal(row, rows[cursor + index]);
      seen.push(...page.rows);
      if (page.nextCursor === undefined) {
        assert.equal(Object.hasOwn(page, "nextCursor"), false);
        break;
      }
      assert.equal(page.nextCursor, cursor + page.rows.length);
      assert.ok(page.nextCursor > cursor && page.nextCursor < rows.length);
      cursor = page.nextCursor;
      assert.ok(step < rows.length, "bounded traversal must terminate");
    }
    assert.deepEqual(seen, rows);
  });
}

test("empty and exhausted feed pages omit the next cursor", () => {
  assert.deepEqual(pageProductFeedRows(products(0)), { rows: [] });
  const rows = products(3);
  for (const cursor of [3, 4, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(pageProductFeedRows(rows, { pageSize: 1, cursor }), { rows: [] });
  }
});

test("invalid feed cursors retain their RangeError contract", () => {
  const rows = products(3);
  for (const cursor of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => pageProductFeedRows(rows, { pageSize: 1, cursor }), {
      name: "RangeError", message: "invalid feed cursor",
    });
  }
});
