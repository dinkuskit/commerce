import { createElement, useEffect, useRef, useState } from "react";
import { BlockRenderer, type BlockInteraction, type BlockResponse } from "@emdash-cms/blocks";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

/** Native Store section uses the same declarative form and authority as Registry. */
export function MerchantSettingsSection() {
  const [response, setResponse] = useState<BlockResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let mounted = true;
    void send({ type: "page_load", page: "/settings" })
      .then((value) => { if (mounted) setResponse(value); })
      .catch((error: unknown) => { if (mounted) setFailure(error instanceof Error ? error.message : "Could not load merchant settings"); });
    return () => { mounted = false; };
  }, []);
  async function interact(input: BlockInteraction) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailure(null);
    try { setResponse(await send(input)); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Could not save merchant settings"); }
    finally { busy.current = false; setPending(false); }
  }
  return createElement("section", { "aria-label": "Merchant settings", "aria-busy": pending },
    failure ? createElement("p", { role: "alert" }, failure) : null,
    response ? createElement("fieldset", { disabled: pending, style: { border: 0, padding: 0, margin: 0 } },
      createElement(BlockRenderer, { blocks: response.blocks, onAction: (input: BlockInteraction) => void interact(input) }))
      : createElement("p", null, "Loading merchant settings…"));
}
async function send(input: BlockInteraction): Promise<BlockResponse> {
  const result = await apiFetch("/_emdash/api/plugins/dinkus-commerce/merchant-store-settings", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  return parseApiResponse<BlockResponse>(result, "Could not access merchant settings");
}
