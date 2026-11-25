import type { BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import { button, fresh, input, note, object, submit, text } from "./common.js";

type Category = { id: string; name: string };
const words = (value: unknown) => typeof value === "string" ? value : "";

/**
 * Shopify Standard Product Taxonomy categories from the DinkusKit catalog, best first: those
 * nearest a search or the page's own words, or the one a saved category id names. The full list
 * is too big to ship in Commerce, so the catalog answers (template-product-category-pick-20261124).
 */
const categories = async (ctx: PluginContext, q: string): Promise<Category[]> => {
  const answer = await ctx.http!.fetch("https://catalog.dinkuskit.com/api/categories?q=" + encodeURIComponent(q.slice(0, 2000)), { redirect: "error" });
  return answer.ok ? ((await answer.json()) as { categories: Category[] }).categories : [];
};

/**
 * The Product category panel on a product page, copying Shopify's Category box: an unpicked page
 * gets the best match filled in as a suggestion, a search lists matches to use, and saving the
 * page keeps the pick in its product_category field.
 */
export async function productCategoryPanel(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const request = object(route.input), fields = object(object(request.draft ?? {}).fields ?? {}), saved = words(fields.product_category);
  const action = request.action_id, find = action === "find";
  let pick: Category | undefined, found: Category[] = [];
  if (action === "use") pick = object(request.value) as Category;
  else found = await categories(ctx, find ? text(object(request.values).q) : saved || words(fields.title) + " " + words(fields.description)).catch(() => []);
  if (!action && !saved) pick = found[0];
  return {
    blocks: [
      note(pick ? (action ? "" : "Suggested: ") + pick.name + ". Save the page to keep it."
        : saved ? "Category: " + (found.find(c => c.id === saved)?.name ?? saved) : "Uncategorized"),
      { type: "form", block_id: fresh("c"), fields: [input("q", "Search categories")], submit: submit("Search", "find") },
      ...find ? found.map(c => ({ type: "section" as const, text: c.name, accessory: button("Use", "use", c) })) : [],
    ],
    ...pick && { patch: { type: "editor-draft-patch", operations: [{ op: "set", field: "product_category", value: pick.id }] } },
  } as BlockResponse;
}
