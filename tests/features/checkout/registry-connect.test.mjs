import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { cancelConnect, connectState, refreshCheckoutSettings, startConnect, storeKey, storeProof } from "../../../dist/features/checkout/registry-connect.js";
import { finishedConnect } from "../../../dist/admin/connect.js";

// Connect to DinkusKit from Commerce (GrillTrack 080 to 083) against a stand-in DinkusKit.com.
const SITE = "https://shop.example.test", SITE_ID = "site_demo", CONNECTION = "conn_1";
const KEY = "dk_store_" + "c".repeat(43);
const CALLBACK = `${SITE}/_emdash/admin/plugins/r_gshdrqaldna3r7sn/settings`;
const started = (extra = {}) => ({ protocol_version: 2, site_id: SITE_ID, connection_id: CONNECTION, challenge: "challenge-1",
  expires_at: Date.now() + 300_000, interval: 5, verification_uri: `https://dinkuskit.com/account/connect?connection_id=${CONNECTION}`, ...extra });
const checkout = (extra = {}) => JSON.stringify({ schema: "dinkuskit.commerce.registry-checkout/v1", enabled: true, commerceOrigin: SITE, siteId: SITE_ID,
  paymentsOrigin: "https://payments.dinkuskit.com", bindingRef: "binding", providerId: "stripe", stripeAccountId: "acct_demo", mode: "test",
  pricingSchema: "dinkuskit.commerce.checkout-pricing/v1", issuer: "https://dinkuskit.com/account", audience: "dinkus-payments",
  shipping: { configurationId: "free", revision: 1, mode: "free" }, ...extra });

function host({ dinkus = {}, pluginId = "r_gshdrqaldna3r7sn", siteUrl = SITE, connection } = {}) {
  const stored = new Map(connection ? [["connection", { value: JSON.stringify(connection), revision: "1" }]] : []), kv = new Map(), calls = [];
  let revisions = 1;
  const ctx = {
    plugin: { id: pluginId }, site: { url: siteUrl },
    settings: {
      get: async name => stored.get(name)?.value ?? null,
      getVersioned: async name => stored.get(name) ?? null,
      compareAndSet: async (name, revision, value) => {
        if ((stored.get(name)?.revision ?? null) !== revision) return { applied: false };
        stored.set(name, { value, revision: String(++revisions) });
        return { applied: true };
      },
    },
    kv: { get: async name => kv.get(name) ?? null, set: async (name, value) => { kv.set(name, value); }, delete: async name => kv.delete(name) },
    http: { fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method ?? "GET", authorization: init.headers?.authorization, body });
      const answer = dinkus[new URL(url).pathname];
      if (!answer) throw new Error(`unexpected call ${url}`);
      return typeof answer === "function" ? answer(body) : Response.json(answer);
    } },
  };
  return { ctx, kv, calls, saved: () => JSON.parse(stored.get("connection")?.value ?? "{}"), stored };
}
const proof = async (h, input) => {
  const response = await storeProof(input, h.ctx);
  return { status: response.status, body: JSON.parse(response.body.value) };
};

test("Connect: the owner approves, the proof route vouches for this store, and Commerce keeps its own key", async () => {
  let approved = false;
  const h = host({ dinkus: {
    "/api/store-connections": started(),
    "/api/store-connections/token": () => approved ? Response.json({ store_key: KEY, site_id: SITE_ID }) : Response.json({ error: "authorization_pending" }, { status: 400 }),
  } });
  assert.deepEqual(await storeKey(h.ctx), null);
  assert.deepEqual(await startConnect(h.ctx), { state: "pending", uri: `https://dinkuskit.com/account/connect?connection_id=${CONNECTION}` });
  const { code_challenge, ...rest } = h.calls[0].body;
  assert.deepEqual(rest, { protocol_version: 2, client_id: "dinkus-commerce-emdash", service: "commerce", site_origin: SITE,
    callback_uri: CALLBACK, code_challenge_method: "S256" });
  const verifier = h.saved().flow.verifier;
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), code_challenge);
  assert.doesNotMatch(JSON.stringify([...h.kv.values()]), new RegExp(verifier), "the verifier stays in the encrypted setting");

  const receipt = await proof(h, { connection_id: CONNECTION });
  assert.equal(receipt.status, 200);
  assert.deepEqual([receipt.body.client_id, receipt.body.service, receipt.body.site_id, receipt.body.callback_uri, receipt.body.code_challenge],
    ["dinkus-commerce-emdash", "commerce", SITE_ID, CALLBACK, code_challenge]);
  assert.equal((await proof(h, { connection_id: "other" })).status, 404);
  assert.equal((await proof(h, { connection_id: CONNECTION, more: "1" })).status, 400);

  assert.deepEqual(await connectState(h.ctx), { state: "pending", uri: started().verification_uri }, "a page load inside the poll interval asks nothing");
  assert.equal(h.calls.length, 1);
  assert.equal((await connectState(h.ctx, true)).checked, true);
  assert.deepEqual(h.calls.at(-1).body, { client_id: "dinkus-commerce-emdash", connection_id: CONNECTION, code_verifier: verifier });

  approved = true;
  assert.deepEqual(await connectState(h.ctx, true), { state: "connected", siteId: SITE_ID, key: KEY, finished: true }, "this load finished Connect");
  assert.deepEqual(await connectState(h.ctx), { state: "connected", siteId: SITE_ID, key: KEY }, "later loads only show it");
  assert.deepEqual(h.saved(), { siteId: SITE_ID, storeKey: KEY });
  assert.equal((await storeKey(h.ctx)).key, KEY);
  assert.equal((await proof(h, { connection_id: CONNECTION })).status, 404, "a finished Connect vouches for nothing");
});

test("a refused, mismatched or foreign Connect starts over, and Cancel keeps the key the store had", async () => {
  const denied = host({ dinkus: { "/api/store-connections": started(), "/api/store-connections/token": () => Response.json({ error: "access_denied" }, { status: 400 }) } });
  await startConnect(denied.ctx);
  assert.match((await connectState(denied.ctx, true)).failure, /did not approve Commerce/);
  assert.deepEqual(denied.saved(), {});

  const wrong = host({ dinkus: { "/api/store-connections": started(), "/api/store-connections/token": { store_key: KEY, site_id: "site_other" } } });
  await startConnect(wrong.ctx);
  assert.equal((await connectState(wrong.ctx, true)).state, "disconnected");

  const badLink = host({ dinkus: { "/api/store-connections": started({ verification_uri: "https://evil.example/approve" }) } });
  assert.match((await startConnect(badLink.ctx)).failure, /Connect did not finish/);

  const again = host({ connection: { siteId: SITE_ID, storeKey: KEY }, dinkus: { "/api/store-connections": started() } });
  assert.equal((await startConnect(again.ctx)).state, "pending");
  assert.equal((await storeKey(again.ctx)).key, KEY, "the current key works while Connect again waits");
  assert.deepEqual(await cancelConnect(again.ctx), { state: "connected", siteId: SITE_ID, key: KEY });
  assert.deepEqual(again.saved(), { siteId: SITE_ID, storeKey: KEY });

  const otherStore = host({ connection: { siteId: "site_other", storeKey: KEY }, dinkus: { "/api/store-connections": started() } });
  assert.equal((await startConnect(otherStore.ctx)).state, "disconnected");

  for (const options of [{ pluginId: "dinkus-commerce" }, { siteUrl: "http://shop.example.test" }]) {
    const h = host(options);
    assert.match((await startConnect(h.ctx)).failure, /https web address/);
    assert.deepEqual(h.calls, []);
  }
});

test("checkout settings come from DinkusKit.com with a commerce:settings pass, never a paste", async () => {
  let settings = checkout(), status = 200;
  const h = host({ connection: { siteId: SITE_ID, storeKey: KEY }, dinkus: {
    "/api/store-passes": { access_token: "pass.for.settings" },
    "/api/commerce-settings": () => new Response(settings, { status }),
  } });
  assert.equal(await refreshCheckoutSettings(h.ctx), null);
  assert.deepEqual(h.calls[0], { url: "https://dinkuskit.com/api/store-passes", method: "POST", authorization: "Bearer " + KEY,
    body: { site_id: SITE_ID, scope: "commerce:settings", audience: "dinkuskit" } });
  assert.deepEqual([h.calls[1].url, h.calls[1].authorization], ["https://dinkuskit.com/api/commerce-settings", "Bearer pass.for.settings"]);
  assert.equal(h.stored.get("installedCheckout").value, settings);
  const revision = h.stored.get("installedCheckout").revision;
  assert.equal(await refreshCheckoutSettings(h.ctx), null);
  assert.equal(h.stored.get("installedCheckout").revision, revision, "unchanged settings are not written again");

  // Settings for another store or web address, or a refusal, leave the saved ones alone.
  for (const other of [checkout({ siteId: "site_other" }), checkout({ commerceOrigin: "https://other.example.test" })]) {
    settings = other;
    assert.equal(await refreshCheckoutSettings(h.ctx), "unavailable");
  }
  settings = JSON.stringify({ error: "payments_not_connected" }); status = 409;
  assert.equal(await refreshCheckoutSettings(h.ctx), "payments_not_connected");
  assert.equal(h.stored.get("installedCheckout").revision, revision);

  // The documented turned-off settings replace enabled ones.
  settings = JSON.stringify({ schema: "dinkuskit.commerce.registry-checkout/v1", enabled: false }); status = 200;
  assert.equal(await refreshCheckoutSettings(h.ctx), null);
  assert.equal(h.stored.get("installedCheckout").value, settings);

  const unknown = host({ connection: { siteId: SITE_ID, storeKey: KEY }, dinkus: { "/api/store-passes": () => Response.json({ error: "invalid_store_key" }, { status: 401 }) } });
  assert.equal(await refreshCheckoutSettings(unknown.ctx), "invalid_store_key");
  assert.equal(await refreshCheckoutSettings(host().ctx), "not_connected");
});

test("settings saved while a fetch is on its way are not overwritten by the older answer", async () => {
  let h;
  const newer = checkout({ shipping: { configurationId: "free", revision: 9, mode: "free" } });
  h = host({ connection: { siteId: SITE_ID, storeKey: KEY }, dinkus: {
    "/api/store-passes": { access_token: "pass.for.settings" },
    "/api/commerce-settings": async () => {
      // A second fetch (another tab, or the background check) saves newer settings first.
      const current = h.stored.get("installedCheckout");
      await h.ctx.settings.compareAndSet("installedCheckout", current?.revision ?? null, newer);
      return new Response(checkout());
    },
  } });
  assert.equal(await refreshCheckoutSettings(h.ctx), null);
  assert.equal(h.stored.get("installedCheckout").value, newer);
});

test("the proof route vouches only for the Connect still waiting in the encrypted setting", async () => {
  const h = host({ connection: { siteId: SITE_ID, storeKey: KEY }, dinkus: { "/api/store-connections": started() } });
  await startConnect(h.ctx);
  assert.equal((await proof(h, { connection_id: CONNECTION })).status, 200);
  // The setting now holds another flow (a replaced or rolled-back Connect): its old receipt is not vouched for.
  const saved = h.saved(); h.stored.set("connection", { value: JSON.stringify({ ...saved, flow: { ...saved.flow, id: "other-flow" } }), revision: "9" });
  assert.equal((await proof(h, { connection_id: CONNECTION })).status, 404);
  h.stored.set("connection", { value: JSON.stringify(saved), revision: "10" });
  assert.equal((await proof(h, { connection_id: CONNECTION })).status, 200);
  // Cancel removes the receipt too, and the key the store had stays.
  assert.equal((await cancelConnect(h.ctx)).state, "connected");
  assert.equal((await proof(h, { connection_id: CONNECTION })).status, 404);
  assert.equal(h.kv.size, 0, "no receipt is left behind");
  // A refused Connect cleans up the same way.
  const denied = host({ dinkus: { "/api/store-connections": started(), "/api/store-connections/token": () => Response.json({ error: "access_denied" }, { status: 400 }) } });
  await startConnect(denied.ctx); await connectState(denied.ctx, true);
  assert.equal((await proof(denied, { connection_id: CONNECTION })).status, 404);
  assert.equal(denied.kv.size, 0);
});

test("a slow Check of a cancelled Connect never wipes the Connect that replaced it", async () => {
  let answerFirst, first = true;
  const h = host({ dinkus: {
    "/api/store-connections": body => Response.json(started(first ? {} : { connection_id: "conn_2", verification_uri: "https://dinkuskit.com/account/connect?connection_id=conn_2" })),
    "/api/store-connections/token": body => body.connection_id === CONNECTION
      ? new Promise(resolve => { answerFirst = () => resolve(Response.json({ error: "authorization_pending" }, { status: 400 })); })
      : Response.json({ error: "authorization_pending" }, { status: 400 }),
  } });
  await startConnect(h.ctx);
  const slow = connectState(h.ctx, true);
  while (!answerFirst) await new Promise(resolve => setTimeout(resolve, 1));
  // Another tab cancels and connects again while DinkusKit.com is still answering the first Check.
  await cancelConnect(h.ctx); first = false;
  await startConnect(h.ctx);
  const replacement = h.saved().flow.id;
  answerFirst();
  await slow;
  assert.equal(h.saved().flow.id, replacement);
  assert.deepEqual([...h.kv.keys()], ["state:connect:" + replacement], "only the replacement's waiting record is left");
  assert.equal((await proof(h, { connection_id: "conn_2" })).status, 200);
  assert.equal((await proof(h, { connection_id: CONNECTION })).status, 404);
  assert.equal((await connectState(h.ctx, true)).state, "pending", "the replacement still waits for the owner");
  assert.equal(h.saved().flow.id, replacement);
  // Connect again over a waiting Connect drops the old one's record as well.
  await startConnect(h.ctx);
  assert.deepEqual([...h.kv.keys()], ["state:connect:" + h.saved().flow.id]);
});

test("the owner's return after Approve fetches the checkout settings at once", async () => {
  const h = host({ connection: { siteId: SITE_ID, storeKey: KEY }, dinkus: {
    "/api/store-passes": { access_token: "pass.for.settings" }, "/api/commerce-settings": () => new Response(checkout()),
  } });
  const page = await finishedConnect(h.ctx, { state: "connected", siteId: SITE_ID, key: KEY, finished: true }, true);
  assert.deepEqual(h.calls.map(c => new URL(c.url).pathname), ["/api/store-passes", "/api/commerce-settings"]);
  assert.equal(h.stored.get("installedCheckout").value, checkout());
  assert.equal(page.toast.message, "Checkout settings are up to date");
  const refused = host({ connection: { siteId: SITE_ID, storeKey: KEY }, dinkus: {
    "/api/store-passes": { access_token: "pass.for.settings" }, "/api/commerce-settings": () => Response.json({ error: "payments_not_connected" }, { status: 409 }),
  } });
  const shown = JSON.stringify(await finishedConnect(refused.ctx, { state: "connected", siteId: SITE_ID, key: KEY, finished: true }, true));
  assert.match(shown, /Connect Payments, then press Get checkout settings/);
  assert.doesNotMatch(shown, /up to date/);
});

test("a store set up with released 0.4.0 keeps its saved settings, never sends the pasted key, and Connect takes over", async () => {
  // Exactly what 0.4.0 saved: the pasted key in "storeKey" and the pasted checkout settings in "installedCheckout".
  const pasted = "dk_store_" + "p".repeat(43);
  let approved = false;
  const h = host({ dinkus: {
    "/api/store-connections": started(),
    "/api/store-connections/token": () => approved ? Response.json({ store_key: KEY, site_id: SITE_ID }) : Response.json({ error: "authorization_pending" }, { status: 400 }),
    "/api/store-passes": { access_token: "pass.for.settings" },
    "/api/commerce-settings": () => new Response(checkout({ shipping: { configurationId: "free", revision: 2, mode: "free" } })),
  } });
  h.stored.set("storeKey", { value: pasted, revision: "1" });
  h.stored.set("installedCheckout", { value: checkout(), revision: "1" });
  assert.equal(await storeKey(h.ctx), null, "the pasted key is not used");
  assert.deepEqual(await connectState(h.ctx), { state: "disconnected" });
  assert.equal(await refreshCheckoutSettings(h.ctx), "not_connected");
  assert.equal(h.stored.get("installedCheckout").value, checkout(), "the saved checkout settings are kept until Connect replaces them");
  await startConnect(h.ctx); approved = true;
  const state = await connectState(h.ctx, true);
  assert.equal(state.finished, true);
  await finishedConnect(h.ctx, state, true);
  assert.equal(JSON.parse(h.stored.get("installedCheckout").value).shipping.revision, 2, "Connect brings the current settings");
  assert.equal(h.calls.some(c => c.authorization === "Bearer " + pasted), false, "the pasted key never leaves the store");
});
