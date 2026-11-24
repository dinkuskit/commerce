import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import { cancelConnect, connectState, refreshCheckoutSettings, startConnect, type ConnectState } from "../features/checkout/kernel/index.js";
import { adminAuthorized, navigation } from "../shared/admin-blocks.js";
import { button, header, note } from "./common.js";

const AGAIN = "DinkusKit.com no longer knows this store key. Press Connect again.";
/** What the owner does first, and then the button that fetches the settings again. */
const thenGet = (first: string) => first + ", then press Get checkout settings.";
const REFUSED: Record<string, string> = {
  commerce_not_set_up: thenGet("Choose shipping and test or live in Set up Commerce on DinkusKit.com"),
  payments_not_connected: thenGet("Connect Payments"),
  payments_not_set_up: thenGet("Finish setting up Payments"),
  invalid_store_key: AGAIN, site_mismatch: AGAIN,
};
const ACTIONS = ["connect", "connect.check", "connect.cancel", "connect.refresh"];

/** The DinkusKit section of Settings: Connect, the owner's Approve link, and the checkout settings fetch. */
const NAMES: Record<string, string> = { commerce: "Commerce", payments: "Payments", ship: "Ship" };
/** The connected line: the business and the DinkusKit plugins on this store when DinkusKit.com said, else the Store ID alone. */
const connectedLine = (siteId: string, shared?: { business: string; plugins: string[] }) => {
  const names = shared?.plugins.map(p => NAMES[p]) ?? [];
  return names.length ? `Connected to ${shared!.business.trim()} on DinkusKit, store ${siteId}. DinkusKit plugins on this store: ${names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0]}. To disconnect one, open Your stores at DinkusKit.com.`
    : `Connected to DinkusKit.com, store ${siteId}.`;
};
export function connectBlocks(state: ConnectState, admin: boolean, failure?: string, shared?: { business: string; plugins: string[] }): Block[] {
  const banner = (title: string, description: string, variant: "default" | "error" = "default"): Block => ({ type: "banner", variant, title, description });
  const actions = (...elements: object[]): Block[] => admin ? [{ type: "actions", elements } as Block] : [note("An Administrator connects Commerce on this page.")];
  if (state.state === "pending") return [header("DinkusKit"),
    banner("Approve at DinkusKit.com", "The business owner opens this link, signs in and presses Approve. Anyone helping can send the owner the same link."),
    ...(state.checked ? [note("Not approved yet.")] : []),
    ...actions({ type: "link", label: "Approve at DinkusKit.com", target: { kind: "external", url: state.uri }, appearance: "primary" },
      button("Check", "connect.check"), button("Cancel", "connect.cancel"))];
  if (state.state === "connected") return [header("DinkusKit"), note(connectedLine(state.siteId, shared)),
    ...(failure ? [banner("Checkout settings not updated", failure, "error")] : []),
    ...actions(button("Get checkout settings", "connect.refresh"), button("Connect again", "connect"))];
  return [header("DinkusKit"), state.failure || failure ? banner("Connect Commerce", state.failure ?? failure!, "error")
    : banner("Connect Commerce", "Connect this store to DinkusKit.com first, then Payments and Ship. The business owner approves at DinkusKit.com."),
  ...actions({ ...button("Connect", "connect"), style: "primary" })];
}

export const connectInteraction = (input: unknown) => (input as { type?: unknown })?.type === "block_action" && ACTIONS.includes((input as { action_id: string }).action_id);
const refused = (code: string | null) => code === null ? undefined : REFUSED[code] ?? "DinkusKit.com could not give checkout settings right now. Try again in a moment.";

/** Connect's buttons. Only an Administrator connects; the answer is the DinkusKit section alone, so a Connect stays within the sandbox's calls. */
export async function connectAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const admin = adminAuthorized(route), action = (route.input as { action_id: string }).action_id;
  let state: ConnectState, failure: string | undefined;
  try {
    state = !admin ? await connectState(ctx) : action === "connect" ? await startConnect(ctx)
      : action === "connect.cancel" ? await cancelConnect(ctx) : await connectState(ctx, action === "connect.check");
    // A finished Connect fetches the checkout settings at once, as Get checkout settings does.
    if (admin && state.state === "connected" && action !== "connect.cancel") failure = refused(await refreshCheckoutSettings(ctx, state));
  } catch {
    state = { state: "disconnected", failure: "Connect could not finish. Try again in a moment." };
  }
  return { blocks: [header("Commerce settings"), navigation(), ...connectBlocks(state, admin, failure)],
    ...(state.state === "connected" && !failure && action !== "connect.cancel" ? { toast: { type: "success", message: "Checkout settings are up to date" } } : {}) };
}

/** The owner's return after Approve finished Connect: the checkout settings are fetched at once, as after Check. */
export async function finishedConnect(ctx: PluginContext, state: ConnectState & { state: "connected" }, admin: boolean): Promise<BlockResponse> {
  const failure = refused(await refreshCheckoutSettings(ctx, state).catch(() => "unavailable"));
  return { blocks: [header("Commerce settings"), navigation(), ...connectBlocks(state, admin, failure)],
    ...(failure ? {} : { toast: { type: "success", message: "Checkout settings are up to date" } }) };
}
