// dinkus-commerce command tree. The contract is docs/CLI-SPEC.md; this file
// binds that surface to the shared kernel and the Commerce HTTP client.
import { readFileSync } from "node:fs";
import { CliError, EXIT } from "./kernel.mjs";
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
				summary: `Inspect orders. Needs ${TOKEN_ENV}. (planned)`,
				commands: {
					list: {
						summary: "List paid orders. (planned)",
						usage: "orders list [--cursor <cursor>]",
						flags: { cursor },
						run: planned("Commerce shows orders only on the Block Kit admin page (admin route); it has no JSON orders list route."),
					},
					show: {
						summary: "Show one order by its canonical order id. (planned)",
						usage: "orders show <order-id>",
						args: [{ name: "order-id" }],
						run: planned("Commerce shows orders only on the Block Kit admin page (admin route); it has no JSON order read route."),
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
