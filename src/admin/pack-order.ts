import type { InventoryTicketHold } from "../features/checkout/kernel/index.js";

/** Ticket command only. references is empty; the Commerce order number is not included. */
export function inventoryPackCommand(hold: InventoryTicketHold | undefined) {
  const ids = hold?.ticketIds;
  if (!hold?.siteId || !hold.poolId || !ids?.length) return null;
  const command = {
    schema: "dinkuskit.inventory.command/v1" as const,
    commandId: "pack:" + ids.join(","),
    context: { siteId: hold.siteId, poolId: hold.poolId },
    references: [] as [],
  };
  return ids.length === 1
    ? { ...command, type: "stock.pack" as const, payload: { reservationId: ids[0] } }
    : { ...command, type: "stock.pack_all" as const, payload: { reservationIds: [...ids] } };
}
