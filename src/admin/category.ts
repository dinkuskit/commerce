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
 * The Product category panel on a product page, copying Shopify's Category box as far as EmDash
 * lets a panel go: opening it names the saved category, or suggests the best match for the page's
 * own words with a Use button; a search lists matches to use; Use fills the unsaved field, and
 * saving the page keeps it. EmDash sends the unsaved draft only with a click, and only a click may
 * patch it, so opening reads the saved page instead.
 */
export async function productCategoryPanel(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const request = object(route.input), entry = route.ui?.surface === "content-editor-panel" ? route.ui.entry.id : "";
  const fields = object((request.draft ? object(request.draft).fields : entry && (await ctx.content?.get("products", entry).catch(() => null))?.data) || {});
  const saved = words(fields.product_category), action = request.action_id, find = action === "find";
  let pick: Category | undefined, found: Category[] = [];
  if (action === "use") pick = object(request.value) as Category;
  else found = await categories(ctx, find ? text(object(request.values).q) : saved || words(fields.title) + " " + words(fields.description)).catch(() => []);
  const suggest = !action && !saved && found[0], use = (c: Category) => ({ type: "section" as const, text: c.name, accessory: button("Use", "use", c) });
  return {
    blocks: [
      note(pick ? pick.name + ". Save the page to keep it." : suggest ? "Uncategorized. Suggested from its title and description:"
        : saved ? "Category: " + (found.find(c => c.id === saved)?.name ?? saved) : "Uncategorized"),
      ...suggest ? [use(suggest)] : [],
      { type: "form", block_id: fresh("c"), fields: [input("q", "Search categories")], submit: submit("Search", "find") },
      ...find ? found.map(use) : [],
    ],
    ...pick && { patch: { type: "editor-draft-patch", operations: [{ op: "set", field: "product_category", value: pick.id }] } },
  } as BlockResponse;
}
