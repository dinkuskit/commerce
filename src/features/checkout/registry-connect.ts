import type { PluginContext } from "emdash";
import { pluginResponse } from "emdash/plugin";
import { isRecord as object } from "../../shared/record.js";
import { COMMERCE_BETA_REGISTRY_RUNTIME_ID, COMMERCE_REGISTRY_RUNTIME_ID } from "../../shared/plugin-identity.js";
import { registryText as text } from "./registry-guards.js";
import { admitRegistryCheckoutConfig } from "./registry-provider-admission.js";
import { resolveTrustedSiteOrigin } from "./site-scope.js";

/**
 * Connect to DinkusKit (GrillTrack store-connect-per-plugin-key-080 to 083). An Administrator presses
 * Connect, the business owner approves at DinkusKit.com, and Commerce gets its own store key. Commerce
 * connects first: its Connect makes the store at DinkusKit.com. The key and Store ID live in the
 * encrypted "connection" setting; the checkout settings are fetched with a 5-minute pass, never pasted.
 */
const DINKUS = "https://dinkuskit.com";
const CONNECT = DINKUS + "/api/store-connections";
const CLIENT_ID = "dinkus-commerce-emdash";
export const CONNECTION_SETTING = "connection";
/** The fetched checkout settings, written by Commerce only. */
export const CHECKOUT_SETTING = "installedCheckout";
const CONTROL = "state:connect";
const KEY = /^dk_store_[A-Za-z0-9_-]{43}$/, ID = /^[A-Za-z0-9_-]{1,200}$/;

interface Saved { siteId?: string; storeKey?: string; flow?: { id: string; verifier: string } }
interface Control { flowId: string; expiresAt: number; nextPollAt: number; interval: number; uri: string; receipt: Record<string, unknown> & { connection_id: string; site_id: string; site_origin: string } }
export type ConnectState =
  | { state: "connected"; siteId: string; key: string; finished?: true }
  | { state: "pending"; uri: string; checked?: boolean }
  | { state: "disconnected"; failure?: string };

const FIRST = "Connect did not finish. Press Connect to start again.";
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = (size: number) => b64(crypto.getRandomValues(new Uint8Array(size)));
const origin = (ctx: PluginContext) => { const site = resolveTrustedSiteOrigin({ runtimeSiteUrl: ctx.site?.url }); return site.ok ? site.origin : null; };
const installed = (ctx: PluginContext) => [COMMERCE_REGISTRY_RUNTIME_ID, COMMERCE_BETA_REGISTRY_RUNTIME_ID].find(id => id === ctx.plugin?.id);
const post = async (ctx: PluginContext, url: string, body: unknown, key?: string) => {
  const response = await ctx.http!.fetch(url, { method: "POST", cache: "no-store", redirect: "error",
    headers: { accept: "application/json", "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) }, body: JSON.stringify(body) });
  const value: unknown = await response.json().catch(() => null);
  return { ok: response.ok, body: object(value) ? value : {} };
};

async function saved(ctx: PluginContext) {
  const entry = await ctx.settings!.getVersioned<unknown>(CONNECTION_SETTING);
  let value: Saved = {};
  try { const parsed: unknown = typeof entry?.value === "string" ? JSON.parse(entry.value) : null; if (object(parsed)) value = parsed as Saved; } catch { /* empty */ }
  return { value, revision: entry?.revision ?? null };
}
const connected = (value: Saved): ConnectState | null =>
  text(value.siteId) && ID.test(value.siteId) && typeof value.storeKey === "string" && KEY.test(value.storeKey)
    ? { state: "connected", siteId: value.siteId, key: value.storeKey } : null;
const write = (ctx: PluginContext, revision: string | null, value: Saved) =>
  ctx.settings!.compareAndSet(CONNECTION_SETTING, revision, JSON.stringify(value));

/** This plugin's Store ID and key with the setting's revision, or null until Connect has finished. */
export async function storeKey(ctx: PluginContext): Promise<{ siteId: string; key: string; revision: string } | null> {
  const { value, revision } = await saved(ctx), found = connected(value);
  return found?.state === "connected" && revision ? { siteId: found.siteId, key: found.key, revision } : null;
}

/** The connection as the Settings page shows it; a waiting Connect is checked on load once its poll interval has passed, or now on Check. */
export async function connectState(ctx: PluginContext, check = false): Promise<ConnectState> {
  const { value, revision } = await saved(ctx), flow = value.flow;
  if (!flow) return connected(value) ?? { state: "disconnected" };
  const control = await ctx.kv.get<Control>(CONTROL);
  const restart = async (failure = FIRST): Promise<ConnectState> => {
    const { flow: _, ...rest } = value;
    if ((await write(ctx, revision, rest)).applied && control?.flowId === flow.id) await ctx.kv.delete(CONTROL);
    return connected(rest) ?? { state: "disconnected", failure };
  };
  if (!control || control.flowId !== flow.id || control.expiresAt <= Date.now()) return restart();
  if (!check && Date.now() < control.nextPollAt) return { state: "pending", uri: control.uri };
  let answer;
  try {
    answer = await post(ctx, CONNECT + "/token", { client_id: CLIENT_ID, connection_id: control.receipt.connection_id, code_verifier: flow.verifier });
  } catch { return { state: "pending", uri: control.uri }; }
  const { ok, body } = answer;
  if (!ok) {
    if (body.error === "authorization_pending") {
      await ctx.kv.set(CONTROL, { ...control, nextPollAt: Date.now() + control.interval * 1000 });
      return { state: "pending", uri: control.uri, checked: check };
    }
    return restart(body.error === "access_denied" ? "The business owner did not approve Commerce at DinkusKit.com. Press Connect to ask again." : FIRST);
  }
  if (body.site_id !== control.receipt.site_id || typeof body.store_key !== "string" || !KEY.test(body.store_key)) return restart();
  const next = { siteId: control.receipt.site_id, storeKey: body.store_key };
  if (!(await write(ctx, revision, next)).applied) return restart();
  await ctx.kv.delete(CONTROL);
  return { state: "connected", siteId: next.siteId, key: next.storeKey, finished: true };
}

/** Connect, or Connect again: the current key keeps working until DinkusKit.com hands over the next one. */
export async function startConnect(ctx: PluginContext): Promise<ConnectState> {
  const site = origin(ctx), id = installed(ctx);
  if (!site || !site.startsWith("https://") || !id || !ctx.http || !ctx.settings) {
    return { state: "disconnected", failure: "Connect needs this store on its https web address, with Commerce installed from the EmDash Registry." };
  }
  const { value, revision } = await saved(ctx);
  const verifier = random(32), callback = `${site}/_emdash/admin/plugins/${id}/settings`;
  const challenge = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  let answer;
  try {
    answer = await post(ctx, CONNECT, { protocol_version: 2, client_id: CLIENT_ID, service: "commerce", site_origin: site,
      callback_uri: callback, code_challenge: challenge, code_challenge_method: "S256" });
  } catch { return { state: "disconnected", failure: "DinkusKit.com could not be reached. Try again in a moment." }; }
  const { ok, body } = answer, { site_id: siteId, connection_id: connectionId, expires_at: expiresAt, interval } = body;
  const uri = `${DINKUS}/account/connect?connection_id=${encodeURIComponent(String(connectionId))}`, now = Date.now();
  if (!ok || body.protocol_version !== 2 || !text(siteId) || !ID.test(siteId) || !text(connectionId) || !text(body.challenge, 512) ||
      typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 600_000 ||
      typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 60 || body.verification_uri !== uri ||
      value.siteId && value.siteId !== siteId) return { state: "disconnected", failure: FIRST };
  const flowId = random(18);
  if (!(await write(ctx, revision, { ...value, flow: { id: flowId, verifier } })).applied) return { state: "disconnected", failure: FIRST };
  await ctx.kv.set(CONTROL, { flowId, expiresAt, interval, nextPollAt: now + interval * 1000, uri,
    receipt: { version: 2, site_id: siteId, connection_id: connectionId, challenge: body.challenge, client_id: CLIENT_ID, service: "commerce",
      site_origin: site, callback_uri: callback, code_challenge: challenge, expires_at: expiresAt } } satisfies Control);
  return { state: "pending", uri };
}

/** Cancel a waiting Connect; a key the store already had keeps working. */
export async function cancelConnect(ctx: PluginContext): Promise<ConnectState> {
  const { value, revision } = await saved(ctx), { flow, ...rest } = value;
  if (flow && (await write(ctx, revision, rest)).applied && (await ctx.kv.get<Control>(CONTROL))?.flowId === flow.id) await ctx.kv.delete(CONTROL);
  return connected(rest) ?? { state: "disconnected" };
}

/** The public store-proof route: DinkusKit.com reads the waiting Connect's receipt on the store's own web address. */
export async function storeProof(input: unknown, ctx: PluginContext) {
  const reply = (status: number, body: unknown) => pluginResponse({ status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "application/json" },
    body: { kind: "text", value: JSON.stringify(body) } });
  const query = object(input) ? input : {};
  if (Object.keys(query).length !== 1 || !text(query.connection_id)) return reply(400, { error: "invalid_request" });
  try {
    // Only the Connect still waiting in the encrypted setting is vouched for: a cancelled or replaced one is not.
    const control = await ctx.kv.get<Control>(CONTROL);
    if (!control || control.receipt.connection_id !== query.connection_id || control.expiresAt <= Date.now() || control.receipt.site_origin !== origin(ctx)) return reply(404, { error: "not_found" });
    return (await saved(ctx)).value.flow?.id === control.flowId ? reply(200, control.receipt) : reply(404, { error: "not_found" });
  } catch { return reply(503, { error: "connection_unavailable" }); }
}

/**
 * Fetches this store's checkout settings from DinkusKit.com with a commerce:settings pass and saves them
 * when they changed. Settings made for another store or web address are refused. Returns a refusal code.
 */
export async function refreshCheckoutSettings(ctx: PluginContext, known?: { siteId: string; key: string } | null): Promise<string | null> {
  if (!ctx.http) return "not_connected";
  const found = known ?? await storeKey(ctx), site = origin(ctx);
  if (!found || !site) return "not_connected";
  try {
    const pass = await post(ctx, DINKUS + "/api/store-passes", { site_id: found.siteId, scope: "commerce:settings", audience: "dinkuskit" }, found.key);
    if (!pass.ok || !text(pass.body.access_token, 16384)) return typeof pass.body.error === "string" ? pass.body.error : "unavailable";
    const response = await ctx.http!.fetch(DINKUS + "/api/commerce-settings", { cache: "no-store", redirect: "error",
      headers: { accept: "application/json", authorization: "Bearer " + pass.body.access_token } });
    const settings = (await response.text()).slice(0, 16385);
    if (!response.ok) { try { return String(JSON.parse(settings).error); } catch { return "unavailable"; } }
    if (admitRegistryCheckoutConfig(settings, site)?.siteId !== found.siteId) return "unavailable";
    const current = await ctx.settings!.getVersioned<unknown>(CHECKOUT_SETTING);
    if (current?.value !== settings) await ctx.settings!.compareAndSet(CHECKOUT_SETTING, current?.revision ?? null, settings);
    return null;
  } catch { return "unavailable"; }
}
