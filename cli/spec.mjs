// dinkus-commerce command tree. The contract is docs/CLI-SPEC.md; this file
// binds that surface to the shared kernel and the Commerce HTTP client.
import { readFileSync } from "node:fs";
import { CliError, EXIT, usageError } from "./kernel.mjs";
import { DEFAULT_PLUGIN_ID, TOKEN_ENV, URL_ENV, assertQueryValue, createCommerceClient, resolveSite } from "./client.mjs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// Commerce stops a public catalog walk long before this; it only bounds a
// misbehaving service that keeps issuing fresh cursors.
const MAX_PAGES = 10_000;

// ---------------------------------------------------------------------------
// Shared helpers

function connect(ctx) {
	const { siteUrl, pluginId } = resolveSite(ctx.config.resolve);
	const client = createCommerceClient({
		siteUrl,
		siteUrlSource: ctx.config.source("url"),
		pluginId,
		pluginIdSource: ctx.config.source("plugin-id"),
		token: ctx.env[TOKEN_ENV] || undefined,
		timeoutMs: ctx.timeoutMs,
		fetchImpl: ctx.fetchImpl,
		signal: ctx.signal,
	});
	return { client, context: { siteUrl, pluginId } };
}

// Attach the resolved context to errors so --json failures still say where
// the command was pointed.
async function withContext(context, work) {
	try {
		return await work();
	} catch (error) {
		if (error instanceof CliError && !error.details?.context) error.details = { ...error.details, context };
		throw error;
	}
}

function planned(missing) {
	return () => {
		throw new CliError("not_implemented", `Not implemented yet: ${missing}`, { exit: EXIT.failure });
	};
}

// Human output only: never let merchant-supplied text drive the terminal.
const visible = (value) =>
	String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function formatMoney(money) {
	if (!money || typeof money.minor !== "string") return "-";
	const match = /^(-?)(\d+)$/.exec(money.minor);
	if (!match) return visible(`${money.minor} ${money.currency ?? ""}`.trim());
	const digits = match[2].padStart(3, "0");
	return `${match[1]}${digits.slice(0, -2)}.${digits.slice(-2)} ${visible(money.currency ?? "")}`.trim();
}

function table(headers, rows) {
	const cells = [headers, ...rows.map((row) => row.map(visible))];
	const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
	return cells.map((row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join("  ")).join("\n");
}

// ---------------------------------------------------------------------------
// catalog

async function catalogList(ctx) {
	const { client, context } = connect(ctx);
	const start = ctx.flags.cursor === undefined ? undefined : assertQueryValue(ctx.flags.cursor, "--cursor");
	return withContext(context, async () => {
		const products = [];
		let cursor = start;
		let pages = 0;
		const seen = new Set(cursor === undefined ? [] : [cursor]);
		do {
			const page = await client.publicCatalogPage(cursor);
			products.push(...page.products);
			pages += 1;
			cursor = page.cursor;
			if (!ctx.flags.all) break;
			if (cursor !== undefined && seen.has(cursor)) {
				throw new CliError("malformed_response", "Reading the public catalog: the service repeated a page cursor.", { exit: EXIT.contract });
			}
			if (cursor !== undefined) seen.add(cursor);
			if (pages >= MAX_PAGES && cursor !== undefined) {
				throw new CliError("page_limit", `Stopped after ${MAX_PAGES} pages. Continue with --cursor ${visible(cursor)}.`, { exit: EXIT.failure });
			}
		} while (cursor !== undefined);

		const data = { products, ...(cursor === undefined ? {} : { cursor }), ...(ctx.flags.all ? { pages } : {}) };
		const plain = products.map((product) => [
			["record", "product"],
			["id", product.id],
			["sku", product.sku],
			["name", product.name],
			["price.minor", product.price?.minor],
			["price.currency", product.price?.currency],
			["availability.status", product.availability?.status],
			["availability.sellable", product.availability?.sellable],
			["variants", product.variants?.members?.length ?? 0],
		]);
		if (cursor !== undefined) plain.push([["record", "cursor"], ["cursor", cursor]]);
		const human = products.length
			? table(
					["ID", "SKU", "PRICE", "STATUS", "NAME"],
					products.map((product) => [
						product.id,
						product.sku,
						formatMoney(product.price),
						product.availability?.status ?? "-",
						product.variants ? `${product.name} (${product.variants.members?.length ?? 0} variants)` : product.name,
					]),
				)
			: ctx.flags.all ? "No public products." : "No public products on this page.";
		const notes = ctx.mode === "human" && cursor !== undefined
			? [`More products: ${ctx.spec.name} catalog list --cursor ${visible(cursor)} (or --all).`]
			: [];
		return { context, data, plain, human, notes };
	});
}

async function catalogShow(ctx) {
	const { client, context } = connect(ctx);
	const itemId = assertQueryValue(ctx.args["item-id"], "<item-id>");
	return withContext(context, async () => {
		const product = await client.publicCatalogItem(itemId);
		if (product === null) {
			throw new CliError("not_found", `No listable public product has item id ${visible(itemId)}. It may not exist, or it is not priced or listable.`, { exit: EXIT.failure });
		}
		const lines = [
			["id", product.id],
			["name", product.name],
			["sku", product.sku],
			["price", formatMoney(product.price)],
			["status", product.availability?.status ?? "-"],
			["sellable", String(product.availability?.sellable ?? "-")],
			["image", product.image ? product.image.id : "-"],
			["gallery", `${product.gallery?.length ?? 0} images`],
		];
		if (product.variants) {
			lines.push(["options", (product.variants.options ?? []).map((option) => option.label ?? option.optionId).join(", ") || "-"]);
			lines.push(["variants", String(product.variants.members?.length ?? 0)]);
		}
		const width = Math.max(...lines.map(([key]) => key.length));
		const human = lines.map(([key, value]) => `${key.padEnd(width)}  ${visible(value)}`).join("\n");
		return { context, data: product, human };
	});
}

// ---------------------------------------------------------------------------
// products

async function productsList(ctx) {
	const { client, context } = connect(ctx);
	return withContext(context, async () => {
		const data = await client.listProducts();
		const stock = (product) => (product.manageStock ? "managed" : product.stockStatus ?? "-");
		const plain = data.products.map((product) => [
			["record", "product"],
			["catalogItemId", product.catalogItemId],
			["sku", product.sku],
			["name", product.name],
			["regular", product.regular],
			["sale", product.sale],
			["manageStock", product.manageStock],
			["stockStatus", product.stockStatus],
			["variants", product.variantProduct?.members?.length ?? 0],
		]);
		const human = data.products.length
			? table(
					["ID", "SKU", "REGULAR", "SALE", "STOCK", "NAME"],
					data.products.map((product) => [
						product.catalogItemId,
						product.sku ?? "-",
						product.regular ?? "-",
						product.sale ?? "-",
						stock(product),
						product.variantProduct ? `${product.name} (${product.variantProduct.members?.length ?? 0} variants)` : product.name,
					]),
				)
			: "No products.";
		return { context, data, plain, human };
	});
}

// ---------------------------------------------------------------------------
// orders

const STATUS_WORD = { processing: "Processing", completed: "Completed" };
// People read the short number; an order kept before numbering shows its id.
const orderLabel = (order) => `${Number.isSafeInteger(order.number) ? `#${order.number}` : order.orderId}${order.test ? " (TEST)" : ""}`;
const shipTo = (address) =>
	address ? [address.name, address.line1, address.line2, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ") : "-";

// A page position the orders route returned as `next`, printed as a cursor.
function orderOffset(value) {
	if (value === undefined) return 0;
	if (!/^(0|[1-9]\d{0,8})$/.test(value)) throw usageError("--cursor must be a page position printed by a previous orders list.", "invalid_cursor");
	return Number(value);
}

async function ordersList(ctx) {
	const { client, context } = connect(ctx);
	const status = ctx.flags.status;
	if (status !== undefined && !Object.hasOwn(STATUS_WORD, status)) throw usageError("--status must be processing or completed.", "invalid_status");
	let offset = orderOffset(ctx.flags.cursor);
	return withContext(context, async () => {
		const orders = [];
		let total = 0;
		let next;
		let pages = 0;
		do {
			const page = await client.listOrders({ status, offset });
			orders.push(...page.orders);
			total = page.total;
			next = page.next;
			pages += 1;
			if (next !== undefined && next <= offset) {
				throw new CliError("malformed_response", "Listing orders: the service did not move to a later page.", { exit: EXIT.contract });
			}
			offset = next;
		} while (ctx.flags.all && next !== undefined && pages < MAX_PAGES);
		const cursor = next === undefined ? undefined : String(next);
		const data = { orders, total, ...(cursor === undefined ? {} : { cursor }) };
		const plain = orders.map((order) => [
			["record", "order"],
			["orderId", order.orderId],
			["number", order.number],
			["version", order.version],
			["status", order.status],
			["test", order.test],
			["total.minor", order.total?.minor],
			["total.currency", order.total?.currency],
			["paidAt", order.paidAt],
		]);
		if (cursor !== undefined) plain.push([["record", "cursor"], ["cursor", cursor]]);
		const human = orders.length
			? table(
					["ORDER", "VERSION", "STATUS", "TOTAL", "SHIP TO", "ID"],
					orders.map((order) => [orderLabel(order), String(order.version), STATUS_WORD[order.status], formatMoney(order.total), shipTo(order.shipTo), order.orderId]),
				)
			: "No orders.";
		const notes = ctx.mode === "human" && cursor !== undefined ? [`More orders: ${ctx.spec.name} orders list --cursor ${cursor} (or --all).`] : [];
		return { context, data, plain, human, notes };
	});
}

function orderHuman(order) {
	const lines = [
		["order", orderLabel(order)],
		["id", order.orderId],
		["version", String(order.version)],
		["status", STATUS_WORD[order.status]],
		["paid", order.paidAt ?? "-"],
		["total", formatMoney(order.total)],
		["ship to", shipTo(order.shipTo)],
		["email", order.email ?? "-"],
		["phone", order.phone ?? "-"],
		...order.lines.map((line) => ["item", `${line.quantity} x ${line.name} (${line.catalogItemId}) at ${formatMoney(line.unitPrice)}`]),
		...(order.completed
			? [["completed", order.completed.at], ["carrier", order.completed.carrier ?? "-"], ["tracking", order.completed.tracking ?? "-"]]
			: []),
	];
	const width = Math.max(...lines.map(([key]) => key.length));
	return lines.map(([key, value]) => `${key.padEnd(width)}  ${visible(value)}`).join("\n");
}

async function ordersShow(ctx) {
	const { client, context } = connect(ctx);
	const orderId = assertQueryValue(ctx.args["order-id"], "<order-id>");
	return withContext(context, async () => {
		const order = await client.showOrder(orderId);
		if (order === null) throw new CliError("not_found", `No order has id ${visible(orderId)}.`, { exit: EXIT.failure });
		return { context, data: order, human: orderHuman(order) };
	});
}

const ORDER_REFUSALS = {
	outdated: "The order changed since that version, or it is already in that status. Nothing changed; run --dry-run again to see it now.",
	invalid: "Carrier and tracking number must each be 64 characters or fewer, on one line. Nothing changed.",
	not_found: "No order has that id. Nothing changed.",
};

// The orders route applies a change only at the version the caller read, so a
// fresh read is the preview and its version is the confirmation value.
function orderChange(action) {
	const to = action === "complete" ? "completed" : "processing";
	return async (ctx) => {
		const { client, context } = connect(ctx);
		const orderId = assertQueryValue(ctx.args["order-id"], "<order-id>");
		if (ctx.flags["dry-run"] && ctx.flags.confirm !== undefined) throw usageError("--dry-run and --confirm cannot be combined.");
		const confirmed = ctx.flags.confirm;
		if (confirmed !== undefined && !/^[1-9]\d{0,8}$/.test(confirmed)) throw usageError("--confirm must be the order version printed by --dry-run.", "invalid_confirmation");
		if (!ctx.flags["dry-run"] && confirmed === undefined && !ctx.interactive) {
			throw new CliError("confirmation_required", "Changing an order without a prompt needs --confirm with the version from a fresh --dry-run.", { exit: EXIT.blocked });
		}
		const values = action === "complete"
			? { ...(ctx.flags.carrier === undefined ? {} : { carrier: ctx.flags.carrier }), ...(ctx.flags.tracking === undefined ? {} : { tracking: ctx.flags.tracking }) }
			: {};
		return withContext(context, async () => {
			let version = confirmed === undefined ? undefined : Number(confirmed);
			if (version === undefined) {
				const order = await client.showOrder(orderId);
				if (order === null) throw new CliError("not_found", `No order has id ${visible(orderId)}.`, { exit: EXIT.failure });
				if (order.status === to) {
					throw new CliError("already_" + to, `Order ${visible(orderLabel(order))} is already ${STATUS_WORD[to]}. Nothing to change.`, { exit: EXIT.failure });
				}
				const preview = { orderId, number: order.number, version: order.version, from: order.status, to, ...values };
				const human = [
					`Order ${orderLabel(order)}, version ${order.version}: ${STATUS_WORD[order.status]} -> ${STATUS_WORD[to]}`,
					...(action === "complete" ? [`carrier: ${values.carrier ?? "-"}`, `tracking: ${values.tracking ?? "-"}`] : ["Its carrier, tracking number and completion time are cleared."]),
				].map(visible).join("\n");
				if (ctx.flags["dry-run"]) {
					return { outcome: "preview", context, data: preview, confirmation: String(order.version), human: `${human}\nconfirm with: --confirm ${order.version}` };
				}
				ctx.io.stderr.write(`${human}\n`);
				const answer = await ctx.prompt(`Type ${order.version} to confirm, or anything else to cancel: `);
				if (answer !== String(order.version)) throw new CliError("not_confirmed", "Not confirmed; nothing was sent.", { exit: EXIT.blocked });
				version = order.version;
			}
			const data = await client.changeOrder({ action, orderId, version, ...values });
			if (data.result !== "saved") {
				throw new CliError(data.result, ORDER_REFUSALS[data.result], { exit: EXIT.failure, details: { document: { data } } });
			}
			const human = `Order ${orderLabel(data.order)} is now ${STATUS_WORD[data.order.status]} (version ${data.order.version}).`;
			return { context, data, human: visible(human) };
		});
	};
}

// ---------------------------------------------------------------------------
// Spec

const cursor = { type: "string", value: "<cursor>", description: "Opaque page cursor returned by a previous page." };
const dryRun = { type: "boolean", description: "Preview the exact change and print a confirmation value; send nothing. (planned)" };
const confirm = { type: "string", value: "<value>", description: "Apply only if this matches a fresh preview of the same change. (planned)" };
const amount = (what) => ({ type: "string", value: "<decimal>", required: true, description: `${what} in USD, such as 19.99.` });
const noPreview = (route) =>
	`Commerce has no preview/confirm route for this change. The native ${route} route applies immediately, so the CLI cannot offer --dry-run or a bound --confirm value until Commerce adds one.`;

export const spec = {
	name: "dinkus-commerce",
	version,
	description: "Read a DinkusKit Commerce catalog and products on an EmDash site.",
	schema: "dinkuskit.commerce.cli/v1",
	configName: "commerce",
	docs: "https://github.com/dinkuskit/commerce/blob/main/docs/CLI-SPEC.md",
	envMap: { url: URL_ENV, profile: "DINKUS_COMMERCE_PROFILE" },
	defaults: { "plugin-id": DEFAULT_PLUGIN_ID },
	globals: {
		url: { type: "string", value: "<site-url>", description: `EmDash site URL, such as https://shop.example. Env: ${URL_ENV}.` },
		"plugin-id": { type: "string", value: "<id>", description: `Commerce plugin id on that site (default ${DEFAULT_PLUGIN_ID}).` },
	},
	environment: [
		[TOKEN_ENV, "EmDash API token for admin commands. Never a flag or config value."],
		[URL_ENV, "Default --url."],
		["DINKUS_COMMERCE_PROFILE", "Default --profile."],
		["XDG_CONFIG_HOME", "User config: $XDG_CONFIG_HOME/dinkuskit/commerce/config.json."],
	],
	examples: [
		"dinkus-commerce --url https://shop.example catalog list",
		"dinkus-commerce --url https://shop.example catalog list --all --json | jq -r '.data.products[].sku'",
		"dinkus-commerce --profile staging products list --plain",
	],
	tree: {
		commands: {
			catalog: {
				summary: "Read the public storefront catalog. No credential.",
				commands: {
					list: {
						summary: "List listable products, one page at a time or --all.",
						usage: "catalog list [--cursor <cursor>] [--all]",
						description: "Reads GET catalog/public. Pages hold up to 50 products and may be shorter or empty; follow the cursor until it is absent.",
						flags: {
							cursor,
							all: { type: "boolean", description: "Follow every page cursor and return one combined list." },
						},
						examples: [
							"dinkus-commerce --url https://shop.example catalog list",
							"dinkus-commerce --url https://shop.example catalog list --all --json",
						],
						run: catalogList,
					},
					show: {
						summary: "Show one listable product by its permanent item id.",
						usage: "catalog show <item-id>",
						description: "Reads GET catalog/public/item?itemId=<item-id>. Exits 1 when the product is missing or not listable.",
						args: [{ name: "item-id" }],
						examples: ["dinkus-commerce --url https://shop.example catalog show item_demo --json"],
						run: catalogShow,
					},
				},
			},
			products: {
				summary: `Read products through admin routes. Needs ${TOKEN_ENV}.`,
				commands: {
					list: {
						summary: "List products with Regular, Sale and stock mode (native build).",
						usage: "products list",
						description: `Reads GET catalog-items/list with ${TOKEN_ENV}. The Registry build does not mount this route; the command then exits 1.`,
						examples: ["dinkus-commerce --url https://shop.example products list --json"],
						run: productsList,
					},
					"set-price": {
						summary: "Set a product's Regular price. (planned)",
						usage: "products set-price <item-id> --amount <decimal> (--dry-run | --confirm <value>)",
						args: [{ name: "item-id" }],
						flags: { amount: amount("Regular price"), "dry-run": dryRun, confirm },
						run: planned(noPreview("catalog-items/set-regular-price")),
					},
					"set-sale-price": {
						summary: "Set a product's Sale price. (planned)",
						usage: "products set-sale-price <item-id> --amount <decimal> (--dry-run | --confirm <value>)",
						args: [{ name: "item-id" }],
						flags: { amount: amount("Sale price, lower than Regular,"), "dry-run": dryRun, confirm },
						run: planned(noPreview("catalog-items/set-sale-price")),
					},
					"set-sku": {
						summary: "Change a product's SKU. (planned)",
						usage: "products set-sku <item-id> --sku <sku> (--dry-run | --confirm <value>)",
						args: [{ name: "item-id" }],
						flags: {
							sku: { type: "string", value: "<sku>", required: true, description: "New unique SKU. The item id never changes." },
							"dry-run": dryRun,
							confirm,
						},
						run: planned(noPreview("catalog-items/set-sku")),
					},
				},
			},
			orders: {
				summary: `Read orders and mark them shipped. Needs ${TOKEN_ENV} for an administrator.`,
				commands: {
					list: {
						summary: "List paid orders by order number, 50 a page or --all.",
						usage: "orders list [--status <processing|completed>] [--cursor <cursor>] [--all]",
						description: "Sends {action: list} to POST orders. Orders not taken in live mode show TEST. Processing means not shipped yet.",
						flags: {
							status: { type: "string", value: "<processing|completed>", description: "Only Processing (not shipped) or Completed (shipped) orders." },
							cursor,
							all: { type: "boolean", description: "Follow every page and return one combined list." },
						},
						examples: [
							"dinkus-commerce --url https://shop.example orders list --status processing",
							"dinkus-commerce --url https://shop.example orders list --all --json",
						],
						run: ordersList,
					},
					show: {
						summary: "Show one order by its permanent order id.",
						usage: "orders show <order-id>",
						description: "Sends {action: show} to POST orders. Exits 1 when no order has that id.",
						args: [{ name: "order-id" }],
						examples: ["dinkus-commerce --url https://shop.example orders show order:demo --json"],
						run: ordersShow,
					},
					complete: {
						summary: "Mark a Processing order Completed (shipped), with an optional carrier and tracking number.",
						usage: "orders complete <order-id> [--carrier <text>] [--tracking <text>] (--dry-run | --confirm <version>)",
						description:
							"Completed means shipped, never delivered. Commerce applies it only at the order version you confirm, so a changed order is never completed by mistake. No email is sent by Commerce.",
						args: [{ name: "order-id" }],
						flags: {
							carrier: { type: "string", value: "<text>", description: "Carrier, such as USPS. At most 64 characters." },
							tracking: { type: "string", value: "<text>", description: "Tracking number. At most 64 characters." },
							"dry-run": { type: "boolean", description: "Show the change and the version to confirm; send nothing." },
							confirm: { type: "string", value: "<version>", description: "Apply only if the order is still at this version (from --dry-run)." },
						},
						examples: [
							"dinkus-commerce --url https://shop.example orders complete order:demo --carrier USPS --tracking 9400100000000000000000 --dry-run",
							"dinkus-commerce --url https://shop.example orders complete order:demo --carrier USPS --tracking 9400100000000000000000 --confirm 1",
						],
						run: orderChange("complete"),
					},
					reopen: {
						summary: "Move a Completed order back to Processing.",
						usage: "orders reopen <order-id> (--dry-run | --confirm <version>)",
						description: "Clears its carrier, tracking number and completion time. Applied only at the order version you confirm.",
						args: [{ name: "order-id" }],
						flags: {
							"dry-run": { type: "boolean", description: "Show the change and the version to confirm; send nothing." },
							confirm: { type: "string", value: "<version>", description: "Apply only if the order is still at this version (from --dry-run)." },
						},
						examples: ["dinkus-commerce --url https://shop.example orders reopen order:demo --confirm 2"],
						run: orderChange("reopen"),
					},
				},
			},
			settings: {
				summary: `Read store settings. Needs ${TOKEN_ENV}. (planned)`,
				commands: {
					show: {
						summary: "Show catalog and storefront settings. (planned)",
						usage: "settings show",
						run: planned(
							"Commerce has no read-only settings route. The native build can read settings/out-of-stock-listing and settings/placeholder-image but not settings/storefront-availability, and the Registry build has none.",
						),
					},
				},
			},
		},
	},
};
