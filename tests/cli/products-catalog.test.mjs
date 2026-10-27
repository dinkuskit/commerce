import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../../cli/kernel.mjs";
import { spec } from "../../cli/spec.mjs";
import { shop } from "../features/catalog/catalog-store.mjs";

// #190: the CLI's product commands drive the real catalog API (catalog-api-20261027)
// through EmDash's envelope, the way a Registry store answers.
const SITE = "https://shop.example";
const TOKEN = ["fixture", "never", "printed"].join("-");

function store() {
  const { ctx, call } = shop();
  const bodies = [];
  const hooks = { beforeWrite: undefined };
  const fetchImpl = async (url, init) => {
    const route = new URL(url).pathname.replace("/_emdash/api/plugins/dinkus-commerce/", "");
    if (route !== "catalog" || init.method !== "POST") return new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } }), { status: 404 });
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers["x-emdash-request"], "1");
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.op !== "get" && hooks.beforeWrite) { const hook = hooks.beforeWrite; hooks.beforeWrite = undefined; await hook(call); }
    try {
      return new Response(JSON.stringify({ success: true, data: await call(body) }), { status: 200 });
    } catch (error) {
      // What a Registry store answers for a thrown error (tests/sandbox/orders-blocks.spec.mjs records it).
      return new Response(JSON.stringify({ success: false, error: { code: "ROUTE_ERROR", message: `Plugin r_gshdrqaldna3r7sn:0.7.0 route catalog failed: ${error.message}` } }), { status: 400 });
    }
  };
  async function cli(...argv) {
    let out = "", err = "";
    const code = await runCli(spec, {
      argv: ["--url", SITE, ...argv],
      env: { HOME: "/nonexistent-home", EMDASH_TOKEN: TOKEN },
      cwd: "/",
      stdout: { write: (chunk) => { out += chunk; return true; } },
      stderr: { write: (chunk) => { err += chunk; return true; } },
      fetchImpl,
    });
    return { code, stdout: out, stderr: err, json: () => JSON.parse(out) };
  }
  // A --dry-run, then the change at the value it printed.
  async function apply(...argv) {
    const preview = await cli(...argv, "--dry-run", "--json");
    assert.equal(preview.code, 0, preview.stderr);
    assert.equal(preview.json().outcome, "preview");
    const confirmation = preview.json().confirmation;
    assert.match(confirmation, /^[0-9a-f]{12}$/);
    return cli(...argv, "--confirm", confirmation, "--json");
  }
  return { ctx, bodies, hooks, cli, apply };
}

test("an agent migrates a product with the CLI alone: create, price, choice, stock and SKU", async () => {
  const { ctx, bodies, hooks, cli, apply } = store();

  const dry = await cli("products", "create", "--name", "Runtz", "--sku", "F-RUNTZ", "--command-id", "gfb-runtz", "--page", "page-runtz", "--dry-run", "--json");
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual(dry.json().data.request, { op: "create", commandId: "gfb-runtz", name: "Runtz", sku: "F-RUNTZ", entryId: "page-runtz" });
  assert.equal(bodies.length, 0, "a dry run sends nothing");

  const made = await cli("products", "create", "--name", "Runtz", "--sku", "F-RUNTZ", "--command-id", "gfb-runtz", "--page", "page-runtz", "--json");
  assert.equal(made.code, 0, made.stderr);
  const id = made.json().data.catalogItemId;
  const again = await cli("products", "create", "--name", "Runtz", "--sku", "F-RUNTZ", "--command-id", "gfb-runtz", "--json");
  assert.equal(again.json().data.catalogItemId, id, "a retry with the same --command-id finds the same product");
  assert.equal((await ctx.storage.catalog_items.get(id)).offSale, true, "a Draft");
  assert.deepEqual(await ctx.storage.product_pages.get("e:page-runtz"), { entryId: "page-runtz", catalogItemId: id });

  // A change without a prompt needs a confirmation from a fresh --dry-run.
  bodies.length = 0;
  const blocked = await cli("products", "set-price", id, "--amount", "22.00");
  assert.equal(blocked.code, 4);
  assert.equal(bodies.length, 0);
  const priced = await apply("products", "set-price", id, "--amount", "22.00");
  assert.equal(priced.code, 0, priced.stderr);
  const [sent] = bodies.filter((body) => body.op !== "get");
  assert.match(sent.expected, /^[0-9a-f]{12}$/, "the change carries the preview code to Commerce");
  assert.deepEqual({ ...sent, expected: undefined }, { op: "prices", catalogItemId: id, regular: "22.00", sale: "", expected: undefined });
  assert.equal(priced.json().data.regular, "22.00");

  // A confirmation is bound to what the dry run read.
  const preview = (await cli("products", "set-sale-price", id, "--amount", "19.00", "--dry-run", "--json")).json();
  assert.deepEqual(preview.data.request, { op: "prices", catalogItemId: id, regular: "22.00", sale: "19.00" });
  assert.equal((await apply("products", "set-stock-status", id, "--status", "on-backorder")).code, 0);
  bodies.length = 0;
  const stale = await cli("products", "set-sale-price", id, "--amount", "19.00", "--confirm", preview.confirmation, "--json");
  assert.equal(stale.code, 1);
  assert.equal(stale.json().error.code, "outdated");
  assert.deepEqual(bodies.map((body) => body.op), ["get"], "nothing was written");

  // A change that lands after the CLI's last read, just before its write: Commerce itself refuses the write.
  const raced = (await cli("products", "set-sale-price", id, "--amount", "18.00", "--dry-run", "--json")).json().confirmation;
  hooks.beforeWrite = (call) => call({ op: "weight", catalogItemId: id, weightOz: "3" });
  const lost = await cli("products", "set-sale-price", id, "--amount", "18.00", "--confirm", raced, "--json");
  assert.equal(lost.code, 1);
  assert.equal(lost.json().error.code, "outdated");
  assert.equal((await cli("products", "show", id, "--json")).json().data.product.sale, null, "nothing was saved");

  const tooHigh = await apply("products", "set-sale-price", id, "--amount", "30.00");
  assert.equal(tooHigh.code, 1);
  assert.equal(tooHigh.json().error.code, "refused", "Commerce's own price check answers");
  assert.equal((await apply("products", "set-sale-price", id, "--amount", "19.00")).code, 0);

  const choice = await apply("products", "add-choice", id, "--name", "Size", "--value", "Small", "--value", "Large=F-RUNTZ-L");
  assert.equal(choice.code, 0, choice.stderr);
  const shown = (await cli("products", "show", id, "--json")).json().data.product;
  assert.deepEqual(shown.variantProduct.options[0].values.map((value) => value.label), ["Small", "Large"]);
  assert.equal(shown.variantProduct.members[0].catalogItemId, id, "the product is the first version");
  assert.equal(shown.variantProduct.members[0].stockStatus, "on-backorder");
  const large = shown.variantProduct.members[1].catalogItemId;

  const needsChoice = await cli("products", "set-price", id, "--amount", "25.00", "--dry-run", "--json");
  assert.equal(needsChoice.code, 2);
  assert.equal(needsChoice.json().error.code, "choice_required");
  assert.equal((await apply("products", "set-price", id, "--choice", large, "--amount", "25.00")).code, 0);
  assert.equal((await cli("products", "show", id, "--json")).json().data.product.variantProduct.members[1].regular, "25.00");
  const second = await cli("products", "add-choice", id, "--name", "Color", "--value", "Red", "--value", "Blue=F-RUNTZ-B", "--dry-run", "--json");
  assert.equal(second.json().error.code, "has_choices");

  assert.equal((await apply("products", "set-sku", id, "--sku", "F-RUNTZ-S")).code, 0);
  const conflict = await apply("products", "set-sku", id, "--sku", "F-RUNTZ-L");
  assert.equal(conflict.code, 1);
  assert.deepEqual(conflict.json().error, { code: "refused", message: "Changing the product: sku is already assigned to another catalog item" });
  const human = await cli("products", "show", id);
  assert.match(human.stdout, /sku\s+F-RUNTZ-S/);
  assert.match(human.stdout, /choice\s+Size: Small, Large/);
});

test("weight, identifiers, pictures, feeds, link, archive and restore go through the CLI", async () => {
  const { ctx, cli, apply } = store();
  const id = (await cli("products", "create", "--name", "Mug", "--sku", "MUG", "--command-id", "mug", "--json")).json().data.catalogItemId;

  assert.equal((await apply("products", "set-weight", id, "--oz", "12.5")).code, 0);
  assert.equal((await ctx.storage.catalog_items.get(id)).catalogData.items[id].weightOz, 12.5);
  assert.equal((await apply("products", "set-identifiers", id, "--gtin", "4006381333931", "--brand", "Funky")).code, 0);
  assert.equal((await apply("products", "set-identifiers", id, "--brand", "")).code, 0, "an empty value clears it");
  const record = await ctx.storage.catalog_items.get(id);
  assert.deepEqual([record.gtin, "brand" in record], ["4006381333931", false]);
  const badGtin = await apply("products", "set-identifiers", id, "--gtin", "4006381333932");
  assert.equal(badGtin.json().error.code, "refused");
  assert.match(badGtin.json().error.message, /^Changing the product: .*GTIN/i);

  const pictures = await apply("products", "save-media", id, "--image", "01HAT000000000000000000000", "--gallery", "01SIDE00000000000000000000", "--gallery", "01BACK00000000000000000000");
  assert.equal(pictures.code, 0, pictures.stderr);
  const media = (await cli("products", "show", id, "--json")).json().data.media;
  assert.deepEqual([media.image.mediaId, media.gallery.map((picture) => picture.mediaId)], ["01HAT000000000000000000000", ["01SIDE00000000000000000000", "01BACK00000000000000000000"]]);
  assert.equal((await apply("products", "save-media", id, "--clear-gallery")).code, 0);
  assert.deepEqual((await cli("products", "show", id, "--json")).json().data.media.gallery, []);

  assert.equal((await apply("products", "set-feeds", id, "--channel", "google-merchant")).code, 0);
  assert.deepEqual((await ctx.storage.catalog_items.get(id)).catalogData.feedChannels, ["google-merchant"]);
  assert.equal((await apply("products", "link", id, "--page", "page-mug")).code, 0);
  assert.deepEqual(await ctx.storage.product_pages.get("e:page-mug"), { entryId: "page-mug", catalogItemId: id });

  assert.equal((await apply("products", "archive", id)).code, 0);
  assert.equal((await cli("products", "show", id, "--json")).json().data.product.archivedAt !== undefined, true);
  const twice = await apply("products", "archive", id);
  assert.match((await cli("products", "show", id)).stdout, /state\s+Archived/);
  assert.equal(twice.json().data.changed, false);
  assert.equal((await apply("products", "restore", id)).code, 0);
  assert.match((await cli("products", "show", id)).stdout, /state\s+Draft/);

  const missing = await cli("products", "show", "nope", "--json");
  assert.equal(missing.code, 1);
  assert.equal(missing.json().error.code, "not_found");
  for (const argv of [["set-weight", id], ["set-identifiers", id], ["save-media", id], ["set-feeds", id], ["add-choice", id, "--name", "Size", "--value", "One"], ["add-choice", id, "--name", "Size", "--value", "A=SKU", "--value", "B=SKU2"]]) {
    const usage = await cli("products", ...argv, "--dry-run", "--json");
    assert.equal(usage.code, 2, argv.join(" "));
  }
});
