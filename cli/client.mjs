// HTTP client for the DinkusKit Commerce plugin routes on an EmDash site.
// It speaks only the public HTTP surface under
// <site>/_emdash/api/plugins/<plugin-id>/<route>. It never imports Commerce
// source, so nothing here can reach the Registry bundle (dist/sandbox/plugin.mjs).
import { CliError, EXIT, createHttp, httpFailure, usageError, validateEndpoint } from "./kernel.mjs";

export const TOKEN_ENV = "EMDASH_TOKEN";
export const URL_ENV = "EMDASH_URL";
export const DEFAULT_PLUGIN_ID = "dinkus-commerce";

// Route ids mirror src/features/catalog (route-ids.ts and public.ts). A unit
// test compares them with the built package so they cannot drift silently.
export const ROUTES = Object.freeze({
	publicCatalog: "catalog/public",
	publicCatalogItem: "catalog/public/item",
	listProducts: "catalog-items/list",
});

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

function checkPublicProduct(product, what) {
	if (!isRecord(product) || typeof product.id !== "string" || typeof product.name !== "string" || typeof product.sku !== "string") {
		throw contractError(what, "a product is missing its id, name or sku.");
	}
	return product;
}

export function createCommerceClient({ siteUrl, pluginId, token, timeoutMs, fetchImpl, signal }) {
	const baseUrl = `${siteUrl}/_emdash/api/plugins/${pluginId}`;
	// Public reads never carry the credential, even when one is set.
	const publicHttp = createHttp({ baseUrl, timeoutMs, fetchImpl, signal });
	const adminHttp = () => {
		if (!token) {
			throw new CliError("credential_required", `This command needs an EmDash API token in ${TOKEN_ENV}.`, { exit: EXIT.blocked });
		}
		return createHttp({ baseUrl, headers: { authorization: `Bearer ${token}` }, timeoutMs, fetchImpl, signal });
	};
	// Non-GET admin calls will also need X-EmDash-Request: 1 (EmDash CSRF guard).
	const adminRequest = (method, path, options = {}) =>
		adminHttp()(method, path, method === "GET" ? options : { ...options, headers: { "x-emdash-request": "1", ...options.headers } });

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

		async listProducts() {
			const what = "Listing products";
			const data = unwrap(await adminRequest("GET", `/${ROUTES.listProducts}`), what, {
				onNotFound: routeMissing(
					ROUTES.listProducts,
					"It is mounted only by the native Commerce build; the Registry build only has the Block Kit admin.",
				),
			});
			if (!isRecord(data) || !Array.isArray(data.products)) throw contractError(what, "products is not a list.");
			for (const product of data.products) {
				if (!isRecord(product) || typeof product.catalogItemId !== "string" || typeof product.name !== "string") {
					throw contractError(what, "a product is missing its catalogItemId or name.");
				}
			}
			return data;
		},
	};
}
