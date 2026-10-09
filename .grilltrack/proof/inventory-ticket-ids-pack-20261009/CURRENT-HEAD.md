# Current-head proof: ticket ids and Pack against Inventory #50

Decision: `commerce-inventory-ticket-ids-pack-001` (locked and confirmed on the
owner's approval, 2026-10-09).

## Latest Commerce head

Branch head `5528d39` (main `289d504` with #72 and #77 merged in, plus the
decision lock). Source changes since `ec58dfd` are main's only; the Pack and
ticket-id code proven below is unchanged.

- `bin/verify-commerce full`: unit 429/429, integration 43/43, `test:sandbox`
  10 passed, `test:sandbox:native-local-stock` 1 passed, `test:sandbox:orders`
  1 passed. `verify-commerce: full passed`.
- `npm run build:sandbox`: `registry_bundle=pass backend_bytes=111048
  headroom_bytes=20024` under the 131,072-byte cap.

The sections below record the earlier head `ec58dfd` and are superseded where
their numbers differ.

Commerce source proven: branch `openclaw/commerce-accept-ticket-ids` at
`ec58dfd9b9cb460c1fd5f90075d83b07dd3e71ce` (PR #78 head `a979d51` with `main`
at `6c54ee5` merged in, plus the Pack transport). Inventory source: dinkuskit/inventory
PR #50 head `9c13a0f4625c72939970947267eed19a05f22142`, unmodified except for
the added proof test below (not committed to Inventory).

## What ran

One vitest-pool-workers test in Inventory's hosted config
(`vitest.hosted.config.ts`, workerd, compatibility date 2026-08-28) that
imports Commerce's built `dist/` modules:

1. Inventory: connect a synthetic account, register `sku_hat` and
   `sku_shirt`, set opening stock.
2. Commerce `startCheckout` for 3 hats and 2 shirts (synthetic catalog,
   synthetic payments, synthetic contact email). Its inventory provider is
   Inventory's real `createCheckoutInventoryPort` running inside the pool
   Durable Object.
3. Commerce `reconcileCheckout` to paid. The order carries the ticket ids
   reserve returned (one per stock line; three hats stay one ticket).
4. Commerce Orders `ordersBlocks` Pack action with
   `createInventoryPackTransport`, whose fetch goes into Inventory's real
   `createHostedInventoryHandler` (`POST /v1/stock/pack`). Authentication is
   a test stub that maps one synthetic bearer value to the account principal;
   Inventory's JWKS verification is not exercised.
5. Pack again (replay), then read `inventory_reservations` rows.
6. Fail closed: a wrong bearer (Inventory 401) and an Inventory without the
   route (404) both render Not packed. The Commerce cart record is byte-for-byte
   unchanged after every Pack.

## Result

`Test Files 2 passed (2)`, `Tests 3 passed (3)` (the e2e test plus
Inventory's own two `stock-pack.test.mjs` cases). Recorded output:

```json
{
  "reserve": {
    "outcome": "reserved",
    "ticketIds": [
      "2685b1dc-dc25-4227-8ede-dd4ced1664ba",
      "eb8d8adb-37c2-4d52-868b-ffa9198f7738"
    ]
  },
  "orderTicketIds": [
    "2685b1dc-dc25-4227-8ede-dd4ced1664ba",
    "eb8d8adb-37c2-4d52-868b-ffa9198f7738"
  ],
  "pack": {
    "status": 200,
    "type": "stock.pack_all",
    "commandId": "commerce.pack:ea45344a0f84ba485fdf4f11a6f326d2fd412f0f06eda4885232efb1c15702e3",
    "outcome": "packed_all"
  },
  "replay": {
    "status": 200,
    "outcome": "packed_all"
  },
  "rows": [
    {
      "reservation_id": "2685b1dc-dc25-4227-8ede-dd4ced1664ba",
      "status": "packed"
    },
    {
      "reservation_id": "eb8d8adb-37c2-4d52-868b-ffa9198f7738",
      "status": "packed"
    }
  ]
}
```

Pack sent `stock.pack_all` with both ticket ids and no Commerce order id.
Inventory answered 200 `packed_all`, the same answer on replay (stable
command id), and both reservations are `packed`. Commerce showed
"Packed in Inventory", kept Fulfillment "Not recorded", and wrote nothing.

Finding fixed by this run: the first attempt failed closed because the
transport passed `redirect: "error"`, which Workers' fetch rejects. Commit
`ec58dfd` switches to `redirect: "manual"`; any non-200, including a 3xx,
is still Not packed.

## Commerce checks on head ec58dfd (superseded by the latest head above)

- `bin/verify-commerce full`: quick (typecheck, 422/422 unit,
  `public_repository_contract=clean`, `feature_contract=clean`),
  integration 41/41, `test:sandbox` 10 passed, `test:sandbox:native-local-stock`
  1 passed, `test:sandbox:orders` 1 passed. `verify-commerce: full passed`.
- `npm run build:sandbox`: `registry_bundle=pass backend_bytes=115453
  headroom_bytes=15619` under the 131,072-byte cap.

## Not established

- The installed Registry admin has no Inventory pack binding, so there Pack
  always reports Not packed. Wiring a binding (origin and account credential)
  is follow-up work.
- Inventory #50 is not on Inventory main. Real account JWT verification,
  deployment, and Registry publication are not exercised.

## Reproduce

Copy the test below to `tests/hosted-runtime/commerce-pack-e2e.test.mjs` in an
Inventory checkout at the head above, replace `COMMERCE_ROOT` with the absolute
path of a Commerce checkout at the head above after `npm run build`, then run
`npx vitest run --config vitest.hosted.config.ts tests/hosted-runtime/commerce-pack-e2e.test.mjs`.

```js
// End-to-end proof: Commerce checkout + Orders Pack (dinkuskit/commerce #78) against
// Inventory's real reserve port and hosted POST /v1/stock/pack route (dinkuskit/inventory #50).
// Commerce modules are imported from a built Commerce checkout; replace COMMERCE_ROOT with its absolute path.
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSetOpeningBalance } from "../../src/application/set-opening-balance.ts";
import { createHostedInventoryHandler } from "../../src/cloudflare/hosted-worker.ts";
import { createCheckoutInventoryPort } from "../../src/features/checkout-inventory/index.ts";
import { createCloudflareSqliteInventoryStore } from "../../src/storage/cloudflare-sqlite-inventory-store.ts";
import { createFixtureManagedSku } from "../helpers/managed-sku-fixture.mjs";
import { startCheckout, reconcileCheckout } from "COMMERCE_ROOT/dist/features/checkout/orchestrate.js";
import { createCheckoutStore } from "COMMERCE_ROOT/dist/features/checkout/storage.js";
import { ordersBlocks } from "COMMERCE_ROOT/dist/admin/orders-blocks.js";
import { createInventoryPackTransport } from "COMMERCE_ROOT/dist/admin/orders-pack.js";

function memoryCarts() {
	const rows = new Map();
	let revision = 0;
	return {
		rows,
		async getVersioned(id) {
			const row = rows.get(id);
			return row ? { revision: row.revision, value: structuredClone(row.value) } : null;
		},
		async compareAndSet(id, expected, value) {
			const row = rows.get(id);
			if ((row?.revision ?? null) !== expected) return { applied: false };
			rows.set(id, { revision: String(++revision), value: structuredClone(value) });
			return { applied: true };
		},
		async query() {
			return { items: [...rows].map(([id, row]) => ({ id, data: structuredClone(row.value) })), hasMore: false };
		},
	};
}

const collection = (records) => ({
	records: new Map(records.map((r) => [r.recordId ?? r.itemId, r])),
	async get(id) { return structuredClone(this.records.get(id) ?? null); },
	async query() { return { items: [...this.records].map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: false }; },
});

describe("Commerce #78 Pack against Inventory #50", () => {
	it("persists reserve ticket ids on the Commerce order and packs them through the hosted route", async () => {
		const principal = { accountId: "acct_commerce_e2e", siteId: "site_commerce_e2e" };
		const connected = await env.INVENTORY_ACCOUNTS.getByName(principal.accountId).connectAccount(principal, {
			type: "create", requestId: "req_commerce_e2e", locationName: "Main",
		});
		expect(connected.status).toBe("ready");
		const poolId = connected.operation.poolId;
		const pool = env.INVENTORY_POOLS.getByName(poolId);
		const binding = { providerRef: "dinkuskit.inventory", poolId, defaultFulfillmentLocationId: connected.operation.locationId };
		const actor = { kind: "human", id: principal.accountId, displayName: "Site Administrator", surface: "emdash" };

		await runInDurableObject(pool, async (_instance, state) => {
			const store = createCloudflareSqliteInventoryStore({ storage: state.storage, poolId });
			for (const [skuId, quantity] of [["sku_hat", "10"], ["sku_shirt", "4"]]) {
				await createFixtureManagedSku(store, { poolId, skuId });
				const opening = await createSetOpeningBalance({ store, now: () => new Date(), createReceiptId: () => `rcpt_opening_${skuId}` })({
					schema: "dinkuskit.inventory.command/v1", commandId: `cmd_opening_${skuId}`, type: "stock.opening_balance",
					context: { siteId: principal.siteId, poolId, locationId: connected.operation.locationId },
					payload: { skuId, quantity: { value: quantity, unit: "each" } },
					reason: { code: "opening_balance", note: "Set Initial Stock" }, references: [],
					expectedVersions: [{ skuId, locationId: connected.operation.locationId, version: "0" }],
				}, { principal: actor });
				if (opening.outcome !== "committed") throw new Error(opening.code);
			}
		});

		// Inventory's real CheckoutInventoryPort, run inside the pool Durable Object.
		const reserveResults = [];
		const inventoryPort = {
			reserve: (request) => runInDurableObject(pool, async (_instance, state) => {
				const store = createCloudflareSqliteInventoryStore({ storage: state.storage, poolId });
				const port = createCheckoutInventoryPort({
					store, binding, now: () => new Date(), createReservationId: () => crypto.randomUUID(),
					createReceiptId: () => crypto.randomUUID(), principal: actor, siteId: principal.siteId,
				});
				const result = await port.reserve(request);
				reserveResults.push(result);
				return result;
			}),
			release: () => Promise.resolve("released"),
		};

		// Commerce checkout with synthetic catalog and payments; inventory is real.
		const carts = memoryCarts();
		const items = [["hat", "sku_hat"], ["shirt", "sku_shirt"]].map(([id, sku]) => ({
			recordKind: "catalog-item", itemId: id, name: id, stockManagement: { mode: "managed", status: "active", inventorySkuId: sku },
		}));
		const catalog = {
			catalog: collection(items),
			prices: collection(["hat", "shirt"].map((id) => ({ recordKind: "catalog-price", recordId: id, catalogItemId: id, regular: { currency: "USD", minor: "100" } }))),
			backorderPolicies: collection([]), settings: collection([]), manualAvailability: collection([]),
			configurations: collection([{ recordKind: "store-inventory-configuration", recordId: "config", configurationKey: "active", siteId: principal.siteId, binding, configuredAt: "2026-10-09", updatedAt: "2026-10-09" }]),
		};
		let paid = false;
		const sessions = new Map();
		const lookup = async (request, create) => {
			if (create && !sessions.has(request.attemptId)) sessions.set(request.attemptId, { total: request.total, session: { sessionId: "session-" + request.attemptId, redirectUrl: "https://checkout.example.test/pay", createdAt: 1000, expiresAt: 2800 } });
			const entry = sessions.get(request.attemptId);
			if (!entry) return { outcome: "unknown" };
			return { outcome: paid ? "paid" : "open", attemptId: request.attemptId, total: entry.total, session: entry.session, ...(paid ? { paymentId: "payment-" + request.attemptId } : {}) };
		};
		const execution = {
			store: createCheckoutStore(carts), catalog,
			loadCheckoutContactRequirements: async () => ({ requirePhoneNumber: false, revision: null }),
			availability: { resolveProvider: async () => ({ async readSkuStock(input) {
				const stock = Object.fromEntries(["onHand", "reserved", "outgoingTransferCommitted", "available", "expected", "inTransit"].map((key) => [key, { value: key === "available" || key === "onHand" ? "10" : "0", unit: "each" }]));
				return { schema: "dinkuskit.inventory.sku-stock-read-result/v1", outcome: "found", ...input, stock, locations: [{ locationId: input.scope.locationId, name: "Main", stock }] };
			} }) },
			resolveInventory: async () => inventoryPort,
			payments: { ensureSession: (r) => lookup(r, true), lookup: (r) => lookup(r, false) },
			paymentBindingRef: "synthetic-binding", now: () => 1000,
		};
		execution.resolvePayments = async (ref) => ref === "synthetic-binding" ? execution.payments : null;

		const started = await startCheckout(execution, "e2e-cart", {
			lines: [{ catalogItemId: "hat", quantity: 3 }, { catalogItemId: "shirt", quantity: 2 }],
			contact: { email: "checkout-fixture@example.test" },
		});
		expect(reserveResults).toHaveLength(1);
		expect(reserveResults[0].outcome).toBe("reserved");
		expect(reserveResults[0].ticketIds).toHaveLength(2);
		expect(started.ticketIds).toEqual(reserveResults[0].ticketIds);
		paid = true;
		const done = await reconcileCheckout(execution, "e2e-cart", started.attemptId);
		expect(done.phase).toBe("paid");
		expect(done.order.ticketIds).toEqual(reserveResults[0].ticketIds);

		// Commerce Orders Pack through the HTTP transport into Inventory's hosted handler.
		const handler = createHostedInventoryHandler(env, async (request) => {
			if (request.headers.get("authorization") !== "Bearer synthetic-account-token") throw new Error("unauthorized");
			return principal;
		});
		const wire = [];
		const pack = createInventoryPackTransport({
			inventoryOrigin: "https://inventory.invalid",
			credential: async () => "synthetic-account-token",
			fetch: async (url, init) => {
				const response = await handler(new Request(url, init));
				wire.push({ url, body: JSON.parse(init.body), status: response.status, result: await response.clone().json() });
				return response;
			},
		});
		const route = { user: { role: 50 }, ui: { surface: "admin-page" },
			input: { type: "block_action", action_id: "orders.pack:" + encodeURIComponent(done.order.orderId) } };
		const ctx = { storage: { checkout_carts: { query: () => carts.query() } } };
		const before = JSON.stringify(carts.rows.get("e2e-cart").value);

		const first = JSON.stringify(await ordersBlocks(route, ctx, { pack }));
		expect(first).toContain("Packed in Inventory");
		expect(wire[0].url).toBe("https://inventory.invalid/v1/stock/pack");
		expect(wire[0].body.type).toBe("stock.pack_all");
		expect(wire[0].body.reservationIds).toEqual(done.order.ticketIds);
		expect(JSON.stringify(wire[0].body)).not.toContain(done.order.orderId);
		expect(wire[0].status).toBe(200);
		expect(wire[0].result.outcome).toBe("packed_all");

		const replay = JSON.stringify(await ordersBlocks(route, ctx, { pack }));
		expect(replay).toContain("Packed in Inventory");
		expect(wire[1].status).toBe(200);
		expect(wire[1].result).toEqual(wire[0].result);

		const rows = await runInDurableObject(pool, async (_instance, state) =>
			state.storage.sql.exec("SELECT reservation_id, status FROM inventory_reservations ORDER BY reservation_id").toArray());
		expect(rows.map((row) => row.status)).toEqual(["packed", "packed"]);
		expect(rows.map((row) => row.reservation_id).sort()).toEqual([...done.order.ticketIds].sort());
		expect(JSON.stringify(carts.rows.get("e2e-cart").value)).toBe(before);

		// Fail closed: a signed-out account and an Inventory without the route both report Not packed.
		const signedOut = createInventoryPackTransport({ inventoryOrigin: "https://inventory.invalid", credential: async () => "wrong-token",
			fetch: async (url, init) => handler(new Request(url, init)) });
		expect(JSON.stringify(await ordersBlocks(route, ctx, { pack: signedOut }))).toContain("Not packed");
		const mainInventory = createInventoryPackTransport({ inventoryOrigin: "https://inventory.invalid", credential: async () => "synthetic-account-token",
			fetch: async () => new Response("Not Found", { status: 404 }) });
		expect(JSON.stringify(await ordersBlocks(route, ctx, { pack: mainInventory }))).toContain("Not packed");
		expect(JSON.stringify(carts.rows.get("e2e-cart").value)).toBe(before);

		console.log("COMMERCE_PACK_E2E " + JSON.stringify({ reserve: reserveResults[0], orderTicketIds: done.order.ticketIds,
			pack: { status: wire[0].status, type: wire[0].body.type, commandId: wire[0].body.commandId, outcome: wire[0].result.outcome },
			replay: { status: wire[1].status, outcome: wire[1].result.outcome }, rows }));
	});
});
```
