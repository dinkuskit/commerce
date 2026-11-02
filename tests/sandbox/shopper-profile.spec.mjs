import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";

const ID = "dinkus-commerce";
const BASE = `/_emdash/api/plugins/${ID}/`;
const SESSION = "x-commerce-customer-session";

test("profile HTTP reads work alongside JSON writes and transport refusals", async ({ request, baseURL }) => {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  const headers = { origin: baseURL, "content-type": "application/json" };
  const email = "profile-http@example.test";
  const started = await request.post(BASE + "account/sign-in/start", { headers, data: { email } });
  expect((await started.json()).data.ok).toBe(true);
  let mail;
  await expect.poll(async () => {
    const result = await request.get("/_emdash/api/dev/emails");
    mail = (await result.json()).data.items.find(item => item.message.to === email);
    return Boolean(mail);
  }).toBe(true);
  const code = /[0-9]{6}/.exec(mail.message.subject)[0];
  const verified = (await (await request.post(BASE + "account/sign-in/verify", { headers, data: { email, code } })).json()).data;
  expect(verified.ok).toBe(true);
  const session = verified.capability.session;
  const sqlite = new Database(process.env.COMMERCE_PROOF_DB.replace(/^file:/, ""), { readonly: true });
  const snapshot = () => sqlite.prepare("SELECT collection,id,data,revision FROM _plugin_storage WHERE plugin_id=? AND collection IN ('customers','customer_sessions','orders') ORDER BY collection,id").all(ID);
  const invoke = async ({ path = "account/profile", method = "GET", body, authenticated = true, origin = baseURL } = {}) => {
    const response = await request.fetch(BASE + path, {
      method,
      headers: { ...(authenticated ? { [SESSION]: session } : {}), ...(method === "POST" ? { origin, "content-type": "application/json" } : {}) },
      // Buffers preserve malformed JSON bytes; Playwright JSON-encodes string data.
      ...(body === undefined ? {} : { data: Buffer.from(body) }),
    });
    return { status: response.status(), cache: response.headers()["cache-control"], body: await response.json() };
  };
  try {
    await test.step("signed-in GET orders is a no-store control", async () => {
      const result = await invoke({ path: "account/orders" });
      expect(result.status).toBe(200);
      expect(result.cache).toBe("no-store");
      expect(result.body.data.ok).toBe(true);
      expect(result.body.data.profile.email).toBe(email);
    });
    await test.step("POST profile updates and explicitly clears phone and delivery", async () => {
      const updated = await invoke({ method: "POST", body: JSON.stringify({ phone: "+16175550199" }) });
      expect(updated.status).toBe(200);
      expect(updated.body.data.ok).toBe(true);
      expect(updated.body.data.profile.phone).toBe("+16175550199");
      const cleared = await invoke({ method: "POST", body: JSON.stringify({ phone: null, delivery: null }) });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.ok).toBe(true);
      expect(cleared.body.data.profile.phone).toBeNull();
      expect(cleared.body.data.profile.delivery).toBeNull();
      const reread = await invoke({ path: "account/orders" });
      expect(reread.body.data.profile.phone).toBeNull();
      expect(reread.body.data.profile.delivery).toBeNull();
    });
    for (const [label, options, status, errorCode] of [
      ["malformed JSON", { method: "POST", body: "{" }, 400, "INVALID_PLUGIN_REQUEST"],
      ["body over the declared default 1 MiB limit", { method: "POST", body: JSON.stringify({ phone: "x".repeat(1024 * 1024) }) }, 413, "INVALID_PLUGIN_REQUEST"],
    ]) {
      await test.step(`${label} is refused before mutation`, async () => {
        const before = snapshot();
        const result = await invoke(options);
        expect(result.status).toBe(status);
        expect(result.body.error.code).toBe(errorCode);
        expect(snapshot()).toEqual(before);
      });
    }
    await test.step("missing session is denied without mutation", async () => {
      const before = snapshot();
      const result = await invoke({ method: "POST", body: "{}", authenticated: false });
      expect(result.status).toBe(200);
      expect(result.body.data).toMatchObject({ ok: false, error: { code: "SESSION_DENIED" } });
      expect(snapshot()).toEqual(before);
    });
    await test.step("cross-origin POST is refused by host CSRF before mutation", async () => {
      const before = snapshot();
      const result = await invoke({ method: "POST", body: "{}", origin: "https://other.example.test" });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ success: false, error: { code: "CSRF_REJECTED" } });
      expect(snapshot()).toEqual(before);
    });
    await test.step("unsupported method is HTTP 405", async () => {
      expect((await invoke({ method: "DELETE" })).status).toBe(405);
    });
    await test.step("bodyless GET profile reads the saved nulls with a valid session", async () => {
      const before = snapshot();
      const result = await invoke();
      expect(snapshot()).toEqual(before);
      expect(result.status, JSON.stringify(result)).toBe(200);
      expect(result.cache).toBe("no-store");
      expect(result.body.data.ok).toBe(true);
      expect(result.body.data.profile.phone).toBeNull();
      expect(result.body.data.profile.delivery).toBeNull();
    });
  } finally {
    try {
      const signedOut = await request.post(BASE + "account/sign-out", { headers: { ...headers, [SESSION]: session }, data: {} });
      expect((await signedOut.json()).data).toEqual({ ok: true, signedOut: true });
      const revoked = await invoke({ path: "account/orders" });
      expect(revoked.body.data).toMatchObject({ ok: false, error: { code: "SESSION_DENIED" } });
    } finally {
      sqlite.close();
    }
  }
});
