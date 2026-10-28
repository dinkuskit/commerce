// dinkus-commerce command tree. The contract is docs/CLI-SPEC.md; this file
// binds that surface to the shared kernel and the Commerce HTTP client.
import { createHash } from "node:crypto";
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

// The native build lists prices and stock; a Registry store (Commerce 0.7.0+)
// lists ids, names, SKUs and archive state through the catalog route.
async function listAnyProducts(client) {
	try {
		return await client.listProducts();
	} catch (error) {
		if (!(error instanceof CliError) || error.code !== "route_not_available") throw error;
		const data = await client.catalog({ op: "list" }, "Listing products");
		if (!Array.isArray(data.products) || data.products.some((product) => typeof product?.catalogItemId !== "string" || typeof product.name !== "string")) {
			throw new CliError("malformed_response", "Listing products: a product is missing its catalogItemId or name.", { exit: EXIT.contract });
		}
		return { products: data.products };
	}
}

async function productsList(ctx) {
	const { client, context } = connect(ctx);
	return withContext(context, async () => {
		const data = await listAnyProducts(client);
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

// The catalog route (Commerce 0.7.0+) answers with what the product page panels
// show and runs their checks on every change. A --dry-run reads the product and
// prints a hash of what it read; the change carries that hash as `expected`, and
// Commerce saves it only while the product still hashes the same.
const productState = (current) => createHash("sha256").update(JSON.stringify(current)).digest("hex").slice(0, 12);
const stateWord = (product) => (product.archivedAt ? "Archived" : product.offSale ? "Draft" : "On sale");
const DOLLARS = /^\d{1,7}(\.\d{1,2})?$/;
const STOCK_STATUSES = ["in-stock", "out-of-stock", "on-backorder"];

async function loadProduct(client, itemId) {
	const current = await client.showProduct(itemId);
	if (current === null) throw new CliError("not_found", `No product has id ${visible(itemId)}. A choice is changed through its product with --choice.`, { exit: EXIT.failure });
	return current;
}

function productHuman({ product, media }) {
	const lines = [
		["id", product.catalogItemId],
		["name", product.name],
		["sku", product.sku],
		["state", stateWord(product)],
		["regular", product.regular ?? "-"],
		["sale", product.sale ?? "-"],
		["stock", product.manageStock ? "managed" : product.stockStatus ?? "-"],
		["weight", product.weightOz === undefined ? "-" : `${product.weightOz} oz`],
		["gtin", product.gtin ?? "-"],
		["mpn", product.mpn ?? "-"],
		["brand", product.brand ?? "-"],
		["image", media.image?.mediaId ?? "-"],
		["gallery", `${media.gallery?.length ?? 0} pictures`],
	];
	for (const option of product.variantProduct?.options ?? []) lines.push(["choice", `${option.label}: ${option.values.map((value) => value.label).join(", ")}`]);
	for (const member of product.variantProduct?.members ?? []) {
		const picks = member.selections.map((pick) => pick.valueLabel ?? pick.valueId).join(" / ");
		lines.push(["version", `${member.catalogItemId}  ${picks || "-"}  regular ${member.regular ?? "-"}  sale ${member.sale ?? "-"}  stock ${member.manageStock ? "managed" : member.stockStatus ?? "-"}`]);
	}
	const width = Math.max(...lines.map(([key]) => key.length));
	return lines.map(([key, value]) => `${key.padEnd(width)}  ${visible(value)}`).join("\n");
}

async function productsShow(ctx) {
	const { client, context } = connect(ctx);
	const itemId = assertQueryValue(ctx.args["item-id"], "<item-id>");
	return withContext(context, async () => {
		const current = await loadProduct(client, itemId);
		return { context, data: current, human: productHuman(current) };
	});
}

async function productsCreate(ctx) {
	const { client, context } = connect(ctx);
	const body = {
		op: "create",
		commandId: ctx.flags["command-id"],
		name: ctx.flags.name,
		sku: ctx.flags.sku,
		...(ctx.flags.page === undefined ? {} : { entryId: ctx.flags.page }),
	};
	const human = visible(`New Draft product ${body.name} (${body.sku}), command ${body.commandId}${body.entryId === undefined ? "" : `, for page ${body.entryId}`}.`);
	if (ctx.flags["dry-run"]) return { outcome: "preview", context, data: { request: body }, human: `${human}\nNothing was sent.` };
	return withContext(context, async () => {
		const data = await client.catalog(body, "Creating the product");
		if (typeof data.catalogItemId !== "string") throw new CliError("malformed_response", "Creating the product: catalogItemId is missing.", { exit: EXIT.contract });
		return {
			context,
			data,
			human: visible(`Product ${data.catalogItemId} is a Draft. Price it, then publish its page to put it on sale.`),
		};
	});
}

// The version of a product a price or stock change applies to: the product
// itself, or one of its choices named with --choice.
function priceTarget(product, choice) {
	if (choice === undefined) {
		if (product.variantProduct && product.variantProduct.members.length > 1) {
			throw usageError("This product sells in choices; name one with --choice <item-id> (see products show).", "choice_required");
		}
		return { catalogItemId: product.catalogItemId, regular: product.regular, sale: product.sale, stockStatus: product.stockStatus, manageStock: product.manageStock };
	}
	const member = product.variantProduct?.members.find((candidate) => candidate.catalogItemId === choice);
	if (!member) throw new CliError("not_found", `This product has no choice ${visible(choice)} (see products show).`, { exit: EXIT.failure });
	return member;
}

function amountFlag(ctx) {
	if ((ctx.flags.amount === undefined) === !ctx.flags.clear) throw usageError("Give --amount <decimal> or --clear.", "missing_flag");
	if (ctx.flags.amount !== undefined && !DOLLARS.test(ctx.flags.amount)) throw usageError("--amount must be dollars such as 19.99.", "invalid_amount");
	return ctx.flags.clear ? "" : ctx.flags.amount;
}

// productId names the product the preview read, so Commerce checks the preview code against it.
const pricesBody = (target, change, product) => ({
	op: "prices",
	catalogItemId: target.catalogItemId,
	...(target.catalogItemId === product.catalogItemId ? {} : { productId: product.catalogItemId }),
	regular: target.regular ?? "",
	sale: target.sale ?? "",
	...change,
});
const shown = (value) => (value === "" || value === null || value === undefined ? "none" : value);

const PRODUCT_CHANGES = {
	"set-price": {
		check: amountFlag,
		request: (product, amount, ctx) => {
			const target = priceTarget(product, ctx.flags.choice);
			return { body: pricesBody(target, { regular: amount }, product), lines: [`Regular: ${shown(target.regular)} -> ${shown(amount)}`] };
		},
	},
	"set-sale-price": {
		check: amountFlag,
		request: (product, amount, ctx) => {
			const target = priceTarget(product, ctx.flags.choice);
			return { body: pricesBody(target, { sale: amount }, product), lines: [`Sale: ${shown(target.sale)} -> ${shown(amount)}`] };
		},
	},
	"set-stock-status": {
		check: (ctx) => {
			if (!STOCK_STATUSES.includes(ctx.flags.status)) throw usageError(`--status must be ${STOCK_STATUSES.join(", ")}.`, "invalid_status");
			return ctx.flags.status;
		},
		request: (product, status, ctx) => {
			const target = priceTarget(product, ctx.flags.choice);
			if (target.manageStock) throw new CliError("stock_managed", "Inventory manages this product's stock; Commerce does not set its status.", { exit: EXIT.failure });
			return { body: pricesBody(target, { stockStatus: status }, product), lines: [`Stock: ${shown(target.stockStatus)} -> ${status}`] };
		},
	},
	"set-sku": {
		check: (ctx) => ctx.flags.sku,
		request: (product, sku) => ({ body: { op: "sku", catalogItemId: product.catalogItemId, sku }, lines: [`SKU: ${product.sku} -> ${sku}`, "The item id never changes."] }),
	},
	"set-weight": {
		check: (ctx) => {
			if ((ctx.flags.oz === undefined) === !ctx.flags.clear) throw usageError("Give --oz <decimal> or --clear.", "missing_flag");
			return ctx.flags.clear ? "" : ctx.flags.oz;
		},
		request: (product, oz) => ({
			body: { op: "weight", catalogItemId: product.catalogItemId, weightOz: oz },
			lines: [`Weight: ${product.weightOz === undefined ? "none" : `${product.weightOz} oz`} -> ${oz === "" ? "none" : `${oz} oz`}`],
		}),
	},
	"set-identifiers": {
		check: (ctx) => {
			const fields = Object.fromEntries(["gtin", "mpn", "brand"].filter((name) => ctx.flags[name] !== undefined).map((name) => [name, ctx.flags[name]]));
			if (!Object.keys(fields).length) throw usageError("Give at least one of --gtin, --mpn or --brand (an empty value clears it).", "missing_flag");
			return fields;
		},
		request: (product, fields) => ({
			body: { op: "identifiers", catalogItemId: product.catalogItemId, ...fields },
			lines: Object.entries(fields).map(([name, value]) => `${name.toUpperCase()}: ${shown(product[name])} -> ${shown(value)}`),
		}),
	},
	"save-media": {
		check: (ctx) => {
			if (ctx.flags.image !== undefined && ctx.flags["clear-image"]) throw usageError("--image and --clear-image cannot be combined.");
			if (ctx.flags.gallery !== undefined && ctx.flags["clear-gallery"]) throw usageError("--gallery and --clear-gallery cannot be combined.");
			const change = {
				...(ctx.flags.image !== undefined || ctx.flags["clear-image"] ? { image: ctx.flags["clear-image"] ? null : ctx.flags.image } : {}),
				...(ctx.flags.gallery !== undefined || ctx.flags["clear-gallery"] ? { gallery: ctx.flags["clear-gallery"] ? [] : ctx.flags.gallery } : {}),
			};
			if (!Object.keys(change).length) throw usageError("Give --image, --gallery, --clear-image or --clear-gallery.", "missing_flag");
			return change;
		},
		request: (product, change, ctx, media) => ({
			body: { op: "media", catalogItemId: product.catalogItemId, ...change },
			lines: [
				...("image" in change ? [`Image: ${media.image?.mediaId ?? "none"} -> ${change.image ?? "none"}`] : []),
				...("gallery" in change ? [`Gallery: ${media.gallery?.length ?? 0} pictures -> ${change.gallery.length ? change.gallery.join(", ") : "none"}`] : []),
			],
		}),
	},
	"set-feeds": {
		check: (ctx) => {
			if ((ctx.flags.channel === undefined) === !ctx.flags.none) throw usageError("Give --channel <channel> (repeatable) or --none.", "missing_flag");
			return ctx.flags.none ? [] : ctx.flags.channel;
		},
		request: (product, channels) => ({
			body: { op: "feeds", catalogItemId: product.catalogItemId, channels },
			lines: [`Product feeds: ${channels.length ? channels.join(", ") : "none"}`],
		}),
	},
	link: {
		check: (ctx) => ctx.flags.page,
		request: (product, entryId) => ({
			body: { op: "link", catalogItemId: product.catalogItemId, entryId },
			lines: [`Product page: ${entryId}`, "Set and save that page's commerce_item_id to this product's id through EmDash, then publish it to put the product on sale."],
		}),
	},
	archive: {
		check: () => true,
		request: (product) => ({ body: { op: "archive", catalogItemId: product.catalogItemId, archived: true }, lines: [`${stateWord(product)} -> Archived (off the shop)`] }),
	},
	restore: {
		check: () => false,
		request: (product) => ({ body: { op: "archive", catalogItemId: product.catalogItemId, archived: false }, lines: [`${stateWord(product)} -> Draft (publish its page to sell it)`] }),
	},
	"add-choice": {
		check: (ctx) => {
			const values = (ctx.flags.value ?? []).map((text) => {
				const split = text.lastIndexOf("=");
				return split < 0 ? { label: text.trim() } : { label: text.slice(0, split).trim(), sku: text.slice(split + 1).trim() };
			});
			if (values.length < 2 || values.length > 50) throw usageError("A choice needs 2 to 50 --value flags.", "invalid_choice");
			if (values[0].sku !== undefined || values.slice(1).some((value) => !value.sku)) {
				throw usageError("The first --value is this product itself (no SKU); every other --value is <label>=<sku> for a new version.", "invalid_choice");
			}
			return values;
		},
		request: (product, values, ctx) => {
			if (product.variantProduct?.options.length) {
				throw new CliError("has_choices", "This product already has a choice. The CLI adds a product's first choice; add more in the Dinkus Commerce panel.", { exit: EXIT.failure });
			}
			const optionId = slug(ctx.flags.name, "--name");
			const seen = new Set();
			const entries = values.map((value) => {
				const valueId = slug(value.label, "--value");
				if (seen.has(valueId)) throw usageError(`Two values make the same id "${valueId}".`, "invalid_choice");
				seen.add(valueId);
				return { valueId, ...value };
			});
			// Ids made from the product and the value, so a retry after a stop resumes instead of making more.
			const tag = createHash("sha256").update(`${product.catalogItemId}\n${optionId}`).digest("hex").slice(0, 12);
			return {
				body: {
					op: "choice",
					productId: product.catalogItemId,
					optionId,
					optionLabel: ctx.flags.name,
					values: entries.map((entry, index) => ({
						valueId: entry.valueId,
						label: entry.label,
						member: index === 0
							? { catalogItemId: product.catalogItemId, fulfillment: "physical" }
							: { commandId: `choice-${tag}-${entry.valueId}`.slice(0, 160), name: product.name, sku: entry.sku, fulfillment: "physical" },
					})),
				},
				lines: [
					`Choice ${ctx.flags.name}: ${entries.map((entry) => entry.label).join(", ")}`,
					`${entries[0].label} is this product (${product.sku}); ${entries.slice(1).map((entry) => `${entry.label} is new SKU ${entry.sku}`).join("; ")}.`,
					"New versions start with no price.",
				],
			};
		},
	},
};

function slug(text, flag) {
	const id = String(text ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
	if (!id) throw usageError(`${flag} needs letters or digits.`, "invalid_choice");
	return id;
}

const PRODUCT_REFUSAL = "The product changed since that --dry-run. Nothing changed; run --dry-run again.";

function productChange(name) {
	const change = PRODUCT_CHANGES[name];
	return async (ctx) => {
		const { client, context } = connect(ctx);
		const itemId = assertQueryValue(ctx.args["item-id"], "<item-id>");
		if (ctx.flags["dry-run"] && ctx.flags.confirm !== undefined) throw usageError("--dry-run and --confirm cannot be combined.");
		const confirmed = ctx.flags.confirm;
		if (confirmed !== undefined && !/^[0-9a-f]{12}$/.test(confirmed)) throw usageError("--confirm must be the value printed by --dry-run.", "invalid_confirmation");
		const value = change.check(ctx);
		if (!ctx.flags["dry-run"] && confirmed === undefined && !ctx.interactive) {
			throw new CliError("confirmation_required", "Changing a product without a prompt needs --confirm with the value from a fresh --dry-run.", { exit: EXIT.blocked });
		}
		return withContext(context, async () => {
			const current = await loadProduct(client, itemId);
			const state = productState(current);
			const { body, lines } = change.request(current.product, value, ctx, current.media);
			const human = [`Product ${current.product.name} (${current.product.sku}), ${itemId}:`, ...lines].map(visible).join("\n");
			if (ctx.flags["dry-run"]) {
				return { outcome: "preview", context, data: { catalogItemId: itemId, request: body }, confirmation: state, human: `${human}\nconfirm with: --confirm ${state}` };
			}
			if (confirmed !== undefined && confirmed !== state) throw new CliError("outdated", PRODUCT_REFUSAL, { exit: EXIT.failure });
			if (confirmed === undefined) {
				ctx.io.stderr.write(`${human}\n`);
				const answer = await ctx.prompt(`Type ${state} to confirm, or anything else to cancel: `);
				if (answer !== state) throw new CliError("not_confirmed", "Not confirmed; nothing was sent.", { exit: EXIT.blocked });
			}
			const data = await client.catalog({ ...body, expected: state }, "Changing the product");
			if (data.saved === false) {
				throw new CliError("refused", visible(data.message ?? "Commerce refused the change. Nothing changed."), { exit: EXIT.failure, details: { document: { data } } });
			}
			return { context, data, human: data.changed === false ? "Nothing to change; it was already so." : "Saved." };
		});
	};
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
const dryRun = { type: "boolean", description: "Show the change and the value to confirm; send nothing." };
const confirm = { type: "string", value: "<value>", description: "Apply only if the product still matches that --dry-run." };
const amount = (what) => ({ type: "string", value: "<decimal>", description: `${what} in USD, such as 19.99.` });
const clear = { type: "boolean", description: "Clear it instead." };
const choice = { type: "string", value: "<item-id>", description: "The choice (version) to change, from products show. Required for a product sold in choices." };
const CONFIRM_NOTE = "--dry-run reads the product and prints a confirmation value; with --confirm, Commerce saves the change only while the product still matches it.";

export const spec = {
	name: "dinkus-commerce",
	version,
	description: "Read a DinkusKit Commerce catalog, manage its products, and read and ship its orders on an EmDash site.",
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
				summary: `Read and change products, with the product page panel checks. Needs ${TOKEN_ENV}.`,
				commands: {
					list: {
						summary: "List products: prices and stock on a native store; ids, names, SKUs and archive state on a Registry store.",
						usage: "products list",
						description: `Reads GET catalog-items/list with ${TOKEN_ENV}. The Registry build does not mount it, so the CLI then sends {op: list} to POST catalog (Commerce 0.7.0+); use products show for one product's prices.`,
						examples: ["dinkus-commerce --url https://shop.example products list --json"],
						run: productsList,
					},
					show: {
						summary: "Show one product with its prices, stock, choices and pictures.",
						usage: "products show <item-id>",
						description: "Sends {op: get} to POST catalog (Commerce 0.7.0+). Exits 1 when no product has that id.",
						args: [{ name: "item-id" }],
						examples: ["dinkus-commerce --url https://shop.example products show item_demo --json"],
						run: productsShow,
					},
					create: {
						summary: "Make a Draft product, off the shop until its page is published.",
						usage: "products create --name <name> --sku <sku> --command-id <id> [--page <entry-id>] [--dry-run]",
						description:
							"Sends {op: create} to POST catalog. The product is physical with Manage stock off, as in the product page panel. Sending the same --command-id again finds the same product instead of making another. --page links it to that product page for its Commerce panel. Before publishing, also set and save that page's commerce_item_id field to this product's id through EmDash; publishing the page then puts it on sale.",
						flags: {
							name: { type: "string", value: "<name>", required: true, description: "Product name. Publishing its page later sets it to the page title." },
							sku: { type: "string", value: "<sku>", required: true, description: "Unique SKU." },
							"command-id": { type: "string", value: "<id>", required: true, description: "Your id for this create, such as gfb-runtz, so a retry finds the same product." },
							page: { type: "string", value: "<entry-id>", description: "The Products page entry that sells it." },
							"dry-run": { type: "boolean", description: "Print the request; send nothing." },
						},
						examples: ["dinkus-commerce --url https://shop.example products create --name Runtz --sku F-RUNTZ --command-id gfb-runtz --page 01J0PAGE"],
						run: productsCreate,
					},
					"set-price": {
						summary: "Set or clear a product's Regular price.",
						usage: "products set-price <item-id> (--amount <decimal> | --clear) [--choice <item-id>] (--dry-run | --confirm <value>)",
						description: "Sends {op: prices} with the current Sale and stock kept. A product with no Regular price is not for sale. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { amount: amount("Regular price"), clear, choice, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products set-price item_demo --amount 22.00 --dry-run"],
						run: productChange("set-price"),
					},
					"set-sale-price": {
						summary: "Set or clear a product's Sale price.",
						usage: "products set-sale-price <item-id> (--amount <decimal> | --clear) [--choice <item-id>] (--dry-run | --confirm <value>)",
						description: "Sends {op: prices} with the current Regular and stock kept. Commerce refuses a Sale that is not lower than Regular. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { amount: amount("Sale price, lower than Regular,"), clear, choice, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products set-sale-price item_demo --amount 19.00 --dry-run"],
						run: productChange("set-sale-price"),
					},
					"set-stock-status": {
						summary: "Set an unmanaged product's stock status.",
						usage: "products set-stock-status <item-id> --status <in-stock|out-of-stock|on-backorder> [--choice <item-id>] (--dry-run | --confirm <value>)",
						description: "Sends {op: prices} with the current prices kept. Products whose stock Inventory manages are refused. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { status: { type: "string", value: "<in-stock|out-of-stock|on-backorder>", required: true, description: "The stock status shoppers see." }, choice, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products set-stock-status item_demo --status out-of-stock --dry-run"],
						run: productChange("set-stock-status"),
					},
					"set-sku": {
						summary: "Change a product's SKU.",
						usage: "products set-sku <item-id> --sku <sku> (--dry-run | --confirm <value>)",
						description: "Sends {op: sku}. A SKU another product has is refused. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { sku: { type: "string", value: "<sku>", required: true, description: "New unique SKU. The item id never changes." }, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products set-sku item_demo --sku F-RUNTZ-2 --dry-run"],
						run: productChange("set-sku"),
					},
					"set-weight": {
						summary: "Set or clear a product's shipping weight.",
						usage: "products set-weight <item-id> (--oz <decimal> | --clear) (--dry-run | --confirm <value>)",
						description: "Sends {op: weight}. Ship uses it for labels. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { oz: { type: "string", value: "<decimal>", description: "Weight in ounces, above 0 and up to 2400, such as 12.5." }, clear, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products set-weight item_demo --oz 12.5 --dry-run"],
						run: productChange("set-weight"),
					},
					"set-identifiers": {
						summary: "Set or clear a product's GTIN, MPN or Brand.",
						usage: "products set-identifiers <item-id> [--gtin <gtin>] [--mpn <mpn>] [--brand <brand>] (--dry-run | --confirm <value>)",
						description: "Sends {op: identifiers}. A field you leave out stays as it is. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { gtin: { type: "string", value: "<gtin>", description: "GTIN with a valid GS1 check digit; empty clears it." }, mpn: { type: "string", value: "<mpn>", description: "Manufacturer part number; empty clears it." }, brand: { type: "string", value: "<brand>", description: "Brand; empty clears it." }, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products set-identifiers item_demo --brand Funky --dry-run"],
						run: productChange("set-identifiers"),
					},
					"save-media": {
						summary: "Set a product's image and gallery from EmDash media ids.",
						usage: "products save-media <item-id> [--image <media-id> | --clear-image] [--gallery <media-id> ... | --clear-gallery] (--dry-run | --confirm <value>)",
						description: "Sends {op: media}. Upload pictures with emdash media first. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { image: { type: "string", value: "<media-id>", description: "The product image, an EmDash media id." }, gallery: { type: "string", value: "<media-id>", multiple: true, description: "Gallery pictures in order; replaces the whole gallery." }, "clear-image": { type: "boolean", description: "Remove the product image." }, "clear-gallery": { type: "boolean", description: "Remove every gallery picture." }, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products save-media item_demo --image 01HAT000000000000000000000 --dry-run"],
						run: productChange("save-media"),
					},
					"set-feeds": {
						summary: "Choose which product feeds list a product.",
						usage: "products set-feeds <item-id> (--channel <channel> ... | --none) (--dry-run | --confirm <value>)",
						description: "Sends {op: feeds}. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { channel: { type: "string", value: "<channel>", multiple: true, description: "A feed channel, such as google-merchant." }, none: { type: "boolean", description: "List it in no feed." }, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products set-feeds item_demo --channel google-merchant --dry-run"],
						run: productChange("set-feeds"),
					},
					"add-choice": {
						summary: "Add a product's first choice, such as Size, with a new SKU for each other value.",
						usage: "products add-choice <item-id> --name <label> --value <label> --value <label>=<sku> ... (--dry-run | --confirm <value>)",
						description: "Sends {op: choice}. The product becomes the first version; the others start with no price. A retry resumes instead of making more. Later choices are added in the Dinkus Commerce panel. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { name: { type: "string", value: "<label>", required: true, description: "The choice, such as Size." }, value: { type: "string", value: "<label>[=<sku>]", multiple: true, description: "The first value is this product itself (no SKU); each other value is a new version with its SKU." }, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products add-choice item_demo --name Size --value Small --value Large=F-RUNTZ-L --dry-run"],
						run: productChange("add-choice"),
					},
					"link": {
						summary: "Link a product to the product page that sells it.",
						usage: "products link <item-id> --page <entry-id> (--dry-run | --confirm <value>)",
						description: "Sends {op: link}, which links them for the page's Commerce panel. Before publishing, also set and save that page's commerce_item_id field to this product's id through EmDash; publishing the page then puts it on sale. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { page: { type: "string", value: "<entry-id>", required: true, description: "The Products page entry." }, "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products link item_demo --page 01J0PAGE --dry-run"],
						run: productChange("link"),
					},
					"archive": {
						summary: "Archive a product: off the shop, with Restore.",
						usage: "products archive <item-id> (--dry-run | --confirm <value>)",
						description: "Sends {op: archive, archived: true}. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products archive item_demo --dry-run"],
						run: productChange("archive"),
					},
					"restore": {
						summary: "Restore an archived product as a Draft.",
						usage: "products restore <item-id> (--dry-run | --confirm <value>)",
						description: "Sends {op: archive, archived: false}. Publish its page to sell it again. " + CONFIRM_NOTE,
						args: [{ name: "item-id" }],
						flags: { "dry-run": dryRun, confirm },
						examples: ["dinkus-commerce --url https://shop.example products restore item_demo --dry-run"],
						run: productChange("restore"),
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
