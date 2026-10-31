// HTTP client for the DinkusKit Commerce plugin routes on an EmDash site.
// It speaks only the public HTTP surface under
// <site>/_emdash/api/plugins/<plugin-id>/<route>, plus EmDash's own content API
// for a product's Content > Products page. It never imports Commerce
// source, so nothing here can reach the Registry bundle (dist/sandbox/plugin.mjs).
import { CliError, EXIT, createHttp, httpFailure, usageError, validateEndpoint } from "./kernel.mjs";

export const TOKEN_ENV = "EMDASH_TOKEN";
export const URL_ENV = "EMDASH_URL";
export const DEFAULT_PLUGIN_ID = "dinkus-commerce";

// Route ids mirror src/features/catalog (route-ids.ts and public.ts),
// src/admin/catalog-api.ts and src/features/orders/api.ts. A unit test compares them with the built package
// so they cannot drift silently.
export const ROUTES = Object.freeze({
	publicCatalog: "catalog/public",
	publicCatalogItem: "catalog/public/item",
	catalog: "catalog",
	orders: "orders",
});

// What the orders route answers to complete, reopen and address.
const ORDER_RESULTS = new Set(["saved", "outdated", "invalid", "not_found"]);

const PLUGIN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_QUERY_VALUE = 1024;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function resolveSite(resolve) {
	const url = resolve("url");
	if (url === undefined || url === "") {
		throw usageError(`Set the EmDash site with --url <site-url> or ${URL_ENV}.`, "missing_url");
	}
	const pluginId = resolve("plugin-id") ?? DEFAULT_PLUGIN_ID;
	if (typeof pluginId !== "string" || !PLUGIN_ID.test(pluginId)) {
		throw usageError("--plugin-id must be a lowercase plugin slug such as dinkus-commerce.", "invalid_plugin_id");
	}
	return { siteUrl: validateEndpoint(String(url), "--url"), pluginId };
}

export function assertQueryValue(value, label) {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_QUERY_VALUE) {
		throw usageError(`${label} must be 1-${MAX_QUERY_VALUE} characters.`, "invalid_argument");
	}
	return value;
}

// EmDash wraps every plugin route response as { success: true, data } or
// { success: false, error: { code, message } }. The kernel's httpFailure reads
// a top-level string `error`, so unwrap the EmDash error object first.
function failure(response, what) {
	const error = response.json?.error;
	if (isRecord(error) && typeof error.code === "string") {
		const json = { error: error.code };
		if (typeof error.message === "string") json.message = error.message;
		return httpFailure({ ...response, json }, what);
	}
	return httpFailure(response, what);
}

function unwrap(response, what, { onNotFound }) {
	if (response.status === 404) throw onNotFound();
	if (!response.ok) throw failure(response, what);
	const body = response.json;
	if (!isRecord(body) || body.success !== true || !Object.hasOwn(body, "data")) {
		throw new CliError("malformed_response", `${what}: the response is not an EmDash plugin route envelope.`, { exit: EXIT.contract });
	}
	return body.data;
}

function contractError(what, detail) {
	return new CliError("malformed_response", `${what}: ${detail}`, { exit: EXIT.contract });
}

function routeMissing(route, hint) {
	return () => new CliError("route_not_available", `This install does not expose ${route}. ${hint}`, { exit: EXIT.failure });
}

function checkOrder(order, what) {
	if (
		!isRecord(order) ||
		typeof order.orderId !== "string" ||
		!Number.isSafeInteger(order.version) ||
		(order.status !== "processing" && order.status !== "completed") ||
		typeof order.test !== "boolean" ||
		!Array.isArray(order.lines)
	) {
		throw contractError(what, "an order is missing its orderId, version, status, test mark or lines.");
	}
	return order;
}

function checkPublicProduct(product, what) {
	if (!isRecord(product) || typeof product.id !== "string" || typeof product.name !== "string" || typeof product.sku !== "string") {
		throw contractError(what, "a product is missing its id, name or sku.");
	}
	return product;
}

export function createCommerceClient({ siteUrl, siteUrlSource, pluginId, pluginIdSource, token, timeoutMs, fetchImpl, signal, lifecycle = {} }) {
	const baseUrl = `${siteUrl}/_emdash/api/plugins/${pluginId}`;
	// Public reads never carry the credential, even when one is set.
	const publicHttp = createHttp({ baseUrl, timeoutMs, fetchImpl, signal });
	const adminHttp = (mutating, base = baseUrl) => {
		if (!token) {
			throw new CliError("credential_required", `This command needs an EmDash API token in ${TOKEN_ENV}.`, { exit: EXIT.blocked });
		}
		// A project config file comes with the working directory, so it must not
		// decide which host receives the token.
		if (siteUrlSource === "project") {
			throw new CliError(
				"untrusted_site_url",
				`Refusing to send ${TOKEN_ENV} to a site URL from project config. Pass --url or set ${URL_ENV} for admin commands.`,
				{ exit: EXIT.blocked },
			);
		}
		// The plugin id picks the route path on that host, so it is part of the
		// token's destination too.
		if (pluginIdSource === "project") {
			throw new CliError(
				"untrusted_plugin_id",
				`Refusing to send ${TOKEN_ENV} to a plugin id from project config. Pass --plugin-id or use the default for admin commands.`,
				{ exit: EXIT.blocked },
			);
		}
		return createHttp({ baseUrl: base, headers: { authorization: `Bearer ${token}` }, timeoutMs, signal,
			fetchImpl: mutating ? (url, init) => {
				// Once dispatch starts, SIGINT cannot promise that nothing changed.
				// Mark only after admission and before fetch can yield to the signal handler.
				init.signal.throwIfAborted();
				lifecycle.sending = true;
				return fetchImpl(url, init);
			} : fetchImpl,
		});
	};
	// Non-GET admin calls will also need X-EmDash-Request: 1 (EmDash CSRF guard).
	// POST alone does not imply a mutation: catalog and orders also read with POST.
	const adminRequest = (method, path, options = {}, mutating = false) =>
		adminHttp(mutating)(method, path, method === "GET" ? options : { ...options, headers: { "x-emdash-request": "1", ...options.headers } });

	// Every orders action is one private POST; EmDash checks the token before Commerce sees it.
	async function ordersCall(body, what) {
		const data = unwrap(await adminRequest("POST", `/${ROUTES.orders}`, { body }, body.action !== "list" && body.action !== "show"), what, {
			onNotFound: routeMissing(ROUTES.orders, "Check --url and --plugin-id. The Registry (sandboxed) Commerce build serves it; the native build has no Orders."),
		});
		if (!isRecord(data)) throw contractError(what, "the response is not an object.");
		return data;
	}

	// The catalog API: one private POST per op, with the product page panels' own checks.
	async function catalogCall(body, what) {
		let data;
		try {
			data = unwrap(await adminRequest("POST", `/${ROUTES.catalog}`, { body }, body.op !== "list" && body.op !== "get"), what, {
				onNotFound: routeMissing(ROUTES.catalog, "Check --url and --plugin-id. Commerce 0.7.0 or later serves it."),
			});
		} catch (error) {
			// A Registry store answers a refusal as ROUTE_ERROR with Commerce's reason after the route name.
			const reason = error instanceof CliError && error.code === "ROUTE_ERROR" ? /route catalog failed: (.+)$/s.exec(error.message)?.[1] : undefined;
			// Commerce refused a write whose preview code no longer matches the product.
			if (error instanceof CliError && /The product changed since that preview/.test(reason ?? error.message)) {
				throw new CliError("outdated", "The product changed since that --dry-run. Nothing changed; run --dry-run again.", { exit: EXIT.failure });
			}
			if (reason) throw new CliError("refused", `${what}: ${reason}`, { exit: EXIT.failure });
			throw error;
		}
		if (!isRecord(data)) throw contractError(what, "the response is not an object.");
		return data;
	}

	const publicCatalogMissing = routeMissing(
		ROUTES.publicCatalog,
		"Check --url and --plugin-id. The public catalog is served by the Registry (sandboxed) build.",
	);

	return {
		async publicCatalogPage(cursor) {
			const what = "Reading the public catalog";
			const data = unwrap(await publicHttp("GET", `/${ROUTES.publicCatalog}`, { query: { cursor } }), what, { onNotFound: publicCatalogMissing });
			if (!isRecord(data) || !Array.isArray(data.products)) throw contractError(what, "products is not a list.");
			if (data.cursor !== undefined && (typeof data.cursor !== "string" || data.cursor.length === 0)) {
				throw contractError(what, "the next-page cursor is not a non-empty string.");
			}
			for (const product of data.products) checkPublicProduct(product, what);
			return { products: data.products, cursor: data.cursor };
		},

		async publicCatalogItem(itemId) {
			const what = "Reading the public product";
			const data = unwrap(await publicHttp("GET", `/${ROUTES.publicCatalogItem}`, { query: { itemId } }), what, {
				onNotFound: routeMissing(ROUTES.publicCatalogItem, "Check --url and --plugin-id. The public catalog is served by the Registry (sandboxed) build."),
			});
			return data === null ? null : checkPublicProduct(data, what);
		},

		// Both builds list products through the catalog route's list op (Commerce 0.7.0+); the native-only
		// catalog-items/list route is gone (commerce-one-build-registry-20261031).
		async listProducts() {
			const what = "Listing products";
			const data = await catalogCall({ op: "list" }, what);
			if (!isRecord(data) || !Array.isArray(data.products)) throw contractError(what, "products is not a list.");
			for (const product of data.products) {
				if (!isRecord(product) || typeof product.catalogItemId !== "string" || typeof product.name !== "string") {
					throw contractError(what, "a product is missing its catalogItemId or name.");
				}
			}
			return { products: data.products };
		},

		catalog: catalogCall,

		// Every product is made for its page (catalog-product-needs-page-20261031). The page lives in EmDash, so this
		// finds the Content > Products page with this slug, or makes it as a Draft titled with the product's name.
		async productPage(slug, title) {
			const what = "Making the product page";
			const content = adminHttp(false, `${siteUrl}/_emdash/api/content/products`);
			const entry = (response) => {
				if (!response.ok) throw failure(response, what);
				const data = response.json?.data, item = isRecord(data?.item) ? data.item : data;
				if (!isRecord(item) || typeof item.id !== "string") throw contractError(what, "the page has no id.");
				return item.id;
			};
			const found = await content("GET", `/${encodeURIComponent(slug)}`);
			if (found.status !== 404) return { entryId: entry(found), made: false };
			const made = await adminHttp(true, `${siteUrl}/_emdash/api/content/products`)("POST", "", { body: { slug, data: { title } }, headers: { "x-emdash-request": "1" } });
			return { entryId: entry(made), made: true };
		},

		async showProduct(catalogItemId) {
			const what = "Reading the product";
			const data = await catalogCall({ op: "get", catalogItemId }, what);
			if (data.product === null) return null;
			if (!isRecord(data.product) || typeof data.product.catalogItemId !== "string" || typeof data.product.sku !== "string" || !isRecord(data.media)) {
				throw contractError(what, "the product is missing its catalogItemId, sku or pictures.");
			}
			return data;
		},

		async listOrders({ status, offset }) {
			const what = "Listing orders";
			const data = await ordersCall({ action: "list", ...(status === undefined ? {} : { status }), ...(offset ? { offset } : {}) }, what);
			if (!Array.isArray(data.orders) || !Number.isSafeInteger(data.total) || (data.next !== undefined && !Number.isSafeInteger(data.next))) {
				throw contractError(what, "orders is not a page of orders.");
			}
			for (const order of data.orders) checkOrder(order, what);
			return data;
		},

		async showOrder(orderId) {
			const what = "Reading the order";
			const data = await ordersCall({ action: "show", orderId }, what);
			if (!Object.hasOwn(data, "order")) throw contractError(what, "order is missing.");
			return data.order === null ? null : checkOrder(data.order, what);
		},

		async changeOrder(body) {
			const what = { complete: "Completing the order", address: "Correcting the order's address" }[body.action] ?? "Moving the order back to Processing";
			const data = await ordersCall(body, what);
			if (!ORDER_RESULTS.has(data.result)) throw contractError(what, "the result is not saved, outdated, invalid or not_found.");
			if (data.order !== undefined) checkOrder(data.order, what);
			return data;
		},
	};
}
