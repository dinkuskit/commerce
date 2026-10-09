import assert from "node:assert/strict";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { createSettingsAccess } from "emdash";
import { OptionsRepository } from "emdash/internal/plugins/host";
import { validateBlockResponse } from "@emdash-cms/blocks/server";
import {
  loadCheckoutContactRequirements,
  loadMerchantStoreSettings,
  saveMerchantStoreSettings,
  StoreSettingsError, merchantStoreSettingsBlocks, merchantStoreSettingsAuthorized,
  createMerchantStoreSettingsRoute,
} from "../../../dist/features/store-settings/index.js";

function fixture() {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.exec("CREATE TABLE options (name TEXT PRIMARY KEY, value TEXT NOT NULL, revision TEXT NOT NULL)");
  const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
  const settings = createSettingsAccess(new OptionsRepository(db), "dinkus-commerce", {});
  return { db, sqlite, settings };
}

test("phone settings are independent and first country save defaults omitted lists", async () => {
  const f = fixture();
  assert.deepEqual(await loadCheckoutContactRequirements(f.settings), { requirePhoneNumber: false, revision: null });
  const phone = await saveMerchantStoreSettings(f.settings, { expectedRevision: null, requirePhoneNumber: true });
  assert.equal(phone.settings.storeCountry, null);
  const first = await saveMerchantStoreSettings(f.settings, {
    expectedRevision: phone.revision,
    storeCountry: "ca",
    requirePhoneNumber: true,
  });
  assert.deepEqual(first.settings.sellingCountries, ["CA"]);
  assert.deepEqual(first.settings.shippingCountries, ["CA"]);
  await f.db.destroy();
});

test("lists are independent, explicit empties persist, and later country edits preserve omissions", async () => {
  const f = fixture();
  const first = await saveMerchantStoreSettings(f.settings, {
    expectedRevision: null,
    storeCountry: "US",
    sellingCountries: ["ca", "CA", "mx"],
    shippingCountries: [],
  });
  const second = await saveMerchantStoreSettings(f.settings, {
    expectedRevision: first.revision,
    storeCountry: "GB",
  });
  assert.deepEqual(second.settings.sellingCountries, ["CA", "MX"]);
  assert.deepEqual(second.settings.shippingCountries, []);
  const third = await saveMerchantStoreSettings(f.settings, {
    expectedRevision: second.revision,
    shippingCountries: ["GB", "IE"],
  });
  assert.deepEqual(third.settings.sellingCountries, ["CA", "MX"]);
  assert.deepEqual(third.settings.shippingCountries, ["GB", "IE"]);
  await f.db.destroy();
});

test("invalid input and corrupt storage fail closed", async () => {
  const f = fixture();
  await assert.rejects(
    saveMerchantStoreSettings(f.settings, { expectedRevision: null, storeCountry: "ZZ" }),
    (error) => error instanceof StoreSettingsError && error.code === "INVALID_INPUT",
  );
  await f.settings.compareAndSet("merchantStoreSettings", null, {
    recordKind: "merchant-store-settings",
    storeCountry: "US",
    sellingCountries: ["US"],
    shippingCountries: ["US"],
    requirePhoneNumber: "yes",
  });
  await assert.rejects(loadMerchantStoreSettings(f.settings), /stored requirePhoneNumber is invalid/);
  await f.db.destroy();
});

test("opaque CAS revisions allow one concurrent winner and stale retries do not overwrite", async () => {
  const f = fixture();
  const writes = await Promise.allSettled([
    saveMerchantStoreSettings(f.settings, { expectedRevision: null, requirePhoneNumber: true }),
    saveMerchantStoreSettings(f.settings, { expectedRevision: null, requirePhoneNumber: false }),
  ]);
  assert.equal(writes.filter((entry) => entry.status === "fulfilled").length, 1);
  const current = await loadMerchantStoreSettings(f.settings);
  assert.equal(typeof current.revision, "string");
  assert.equal(writes.filter((entry) => entry.status === "rejected" && entry.reason.code === "CONFLICT").length, 1);
  await f.db.destroy();
});

const route = input => ({ input, user: { role: 40 }, ui: { surface: "admin-page", locale: "en-US", direction: "ltr" },
  request: { method: "POST", url: "https://shop.example.test/admin", headers: {} } });
const values = (country = "", selling = "", shipping = "", phone = false) => ({
  storeCountry: country, sellingCountries: selling, shippingCountries: shipping, requirePhoneNumber: phone,
});
const form = response => response.blocks.find(block => block.type === "form");
const submit = (revision, draft) => ({ type: "form_submit", action_id: "merchant-store-settings.save",
  block_id: "merchant-store-settings:" + (revision ?? "null"), values: draft });

test("actual BlockKit forms default first country after phone-only save and preserve independent edits", async t => {
  const f = fixture(); t.after(() => f.db.destroy());
  const first = await merchantStoreSettingsBlocks(route({ type: "page_load", page: "/settings" }), { settings: f.settings });
  assert.equal(validateBlockResponse(first).valid, true);
  const phone = await merchantStoreSettingsBlocks(route(submit(null, values("", "", "", true))), { settings: f.settings });
  assert.equal(form(phone).fields.find(field => field.action_id === "requirePhoneNumber").initial_value, true);
  const saved = await merchantStoreSettingsBlocks(route(submit((await loadMerchantStoreSettings(f.settings)).revision, values("nz", "", "", true))), { settings: f.settings });
  assert.equal(validateBlockResponse(saved).valid, true);
  const current = await loadMerchantStoreSettings(f.settings);
  assert.deepEqual(current.settings.sellingCountries, ["NZ"]);
  assert.deepEqual(current.settings.shippingCountries, ["NZ"]);
  const edited = await merchantStoreSettingsBlocks(route(submit(current.revision, values("AU", "NZ, CA", "", true))), { settings: f.settings });
  assert.equal(validateBlockResponse(edited).valid, true);
  assert.deepEqual((await loadMerchantStoreSettings(f.settings)).settings.shippingCountries, []);
  assert.deepEqual((await loadMerchantStoreSettings(f.settings)).settings.sellingCountries, ["NZ", "CA"]);
});

test("conflict UI retains old CAS token and draft through repeated retries, explicit reload gets current settings", async t => {
  const f = fixture(); t.after(() => f.db.destroy());
  const first = await saveMerchantStoreSettings(f.settings, { expectedRevision: null, storeCountry: "CA" });
  const latest = await saveMerchantStoreSettings(f.settings, { expectedRevision: first.revision, storeCountry: "NZ", requirePhoneNumber: true });
  const input = submit(first.revision, values("AU", "AU", "AU", false));
  for (let attempt = 0; attempt < 2; attempt++) {
    const refused = await merchantStoreSettingsBlocks(route(input), { settings: f.settings });
    assert.equal(validateBlockResponse(refused).valid, true);
    assert.equal(form(refused).block_id, input.block_id);
    assert.equal(form(refused).fields[0].initial_value, "AU");
    assert.equal(refused.blocks.find(block => block.type === "banner").variant, "error");
    assert.deepEqual(await loadMerchantStoreSettings(f.settings), latest);
  }
  const reloaded = await merchantStoreSettingsBlocks(route({ type: "block_action", action_id: "merchant-store-settings" }), { settings: f.settings });
  assert.equal(form(reloaded).block_id, "merchant-store-settings:" + latest.revision);
  assert.equal(form(reloaded).fields[0].initial_value, "NZ");
});

test("actual SDK permission rejects absent/invalid/low roles and client privilege claims before settings access", async () => {
  const ctx = { get settings() { throw new Error("settings must not be accessed"); } };
  for (const denied of [{ user: undefined }, { user: { role: 30 } }, { user: { role: "40" } }, { ui: undefined }]) {
    const host = { ...route(submit(null, { ...values(), user: { role: 50 }, ui: { surface: "admin-page" }, permissions: ["content:edit_any"] })), ...denied };
    assert.equal(merchantStoreSettingsAuthorized(host), false);
    await assert.rejects(merchantStoreSettingsBlocks(host, ctx), error => error.code === "UNAUTHORIZED");
    const native = Object.defineProperty({ ...host }, "settings", { get: () => { throw new Error("settings must not be accessed"); } });
    await assert.rejects(createMerchantStoreSettingsRoute().handler(native), error => error.code === "UNAUTHORIZED");
  }
  for (const role of [40, 50]) assert.equal(merchantStoreSettingsAuthorized({ ...route({}), user: { role } }), true);
});

test("invalid admin entries preserve draft and never write; country lists require merchant country", async t => {
  const f = fixture(); t.after(() => f.db.destroy());
  for (const draft of [values("ZZ"), values("", "CA"), values("CA", "", "", "true"), values("CA", "ZZ")]) {
    const refused = await merchantStoreSettingsBlocks(route(submit(null, draft)), { settings: f.settings });
    assert.equal(refused.blocks.find(block => block.type === "banner").variant, "error");
    assert.equal(form(refused).block_id, "merchant-store-settings:null");
    assert.equal(form(refused).fields[0].initial_value, draft.storeCountry);
    assert.equal((await loadMerchantStoreSettings(f.settings)).revision, null);
  }
});

test("unreadable or malformed storage never downgrades phone requirement", async () => {
  await assert.rejects(loadCheckoutContactRequirements({ getVersioned: async () => { throw new Error("unavailable"); } }), error => error.code === "STORAGE_UNAVAILABLE");
  for (const value of [null, "", {}, { recordKind: "merchant-store-settings", storeCountry: null, sellingCountries: [], shippingCountries: [] }]) {
    await assert.rejects(loadCheckoutContactRequirements({ getVersioned: async () => ({ revision: "opaque", value }) }), error => error.code === "STORAGE_UNAVAILABLE");
  }
});

test("server rejects malformed input and extra countries must be explicitly recognized", async t => {
  const f = fixture(); t.after(() => f.db.destroy());
  for (const input of [null, [], { expectedRevision: null, requirePhoneNumber: "false" }, { expectedRevision: null, sellingCountries: ["CA"] },
    { expectedRevision: null, storeCountry: "UK" }, { expectedRevision: null, storeCountry: "CA", shippingCountries: "CA" },
    { expectedRevision: null, storeCountry: "CA", sellingCountries: Array(250).fill("CA") }]) {
    await assert.rejects(saveMerchantStoreSettings(f.settings, input), error => error.code === "INVALID_INPUT");
  }
  const saved = await saveMerchantStoreSettings(f.settings, { expectedRevision: null, storeCountry: "CA", shippingCountries: ["ca", "mx", "MX"] });
  assert.deepEqual(saved.settings.shippingCountries, ["CA", "MX"]);
  assert.deepEqual(saved.settings.sellingCountries, ["CA"]);
});


test("read and write outages retain the draft and original revision without claiming success", async t => {
  const f = fixture(); t.after(() => f.db.destroy());
  const saved = await saveMerchantStoreSettings(f.settings, { expectedRevision: null, storeCountry: "CA", requirePhoneNumber: true });
  const input = submit(saved.revision, values("NZ", "NZ", "AU", true));
  for (const event of ["INSERT", "UPDATE"]) f.sqlite.exec(`CREATE TRIGGER refuse_${event} BEFORE ${event} ON options BEGIN SELECT RAISE(ABORT,'synthetic outage'); END`);
  const failed = await merchantStoreSettingsBlocks(route(input), { settings: f.settings });
  assert.equal(failed.blocks.find(b => b.type === "banner").variant, "error");
  assert.equal(form(failed).block_id, input.block_id);
  assert.equal(form(failed).fields[0].initial_value, "NZ");
  assert.deepEqual(await loadMerchantStoreSettings(f.settings), saved);
  const unreadable = await merchantStoreSettingsBlocks(route(input), { settings: { getVersioned: async () => { throw new Error("synthetic outage"); } } });
  assert.equal(validateBlockResponse(unreadable).valid, true);
  assert.equal(form(unreadable).block_id, input.block_id);
  assert.equal(form(unreadable).fields[0].initial_value, "NZ");
});

test("distinct host settings contexts share the same revision-fenced authority", async t => {
  const f = fixture(); t.after(() => f.db.destroy());
  const otherHost = createSettingsAccess(new OptionsRepository(f.db), "dinkus-commerce", {});
  const initial = await saveMerchantStoreSettings(f.settings, { expectedRevision: null, storeCountry: "CA" });
  const results = await Promise.allSettled([
    saveMerchantStoreSettings(f.settings, { expectedRevision: initial.revision, sellingCountries: ["CA", "NZ"] }),
    saveMerchantStoreSettings(otherHost, { expectedRevision: initial.revision, shippingCountries: ["AU"] }),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected" && r.reason.code === "CONFLICT").length, 1);
  assert.deepEqual(await loadMerchantStoreSettings(f.settings), await loadMerchantStoreSettings(otherHost));
});
