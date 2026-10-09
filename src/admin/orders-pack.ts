/**
 * Order Pack through the configured Inventory provider. Commerce never records
 * packed state itself: Inventory owns the tickets, and any answer other than a
 * confirmed pack of exactly these tickets is reported as Not packed.
 */
export type OrderPackBody =
  | { commandId: string; type: 'stock.pack'; reservationId: string }
  | { commandId: string; type: 'stock.pack_all'; reservationIds: string[] };

/** "packed" only when Inventory confirmed this exact command; everything else fails closed. */
export type OrderPackOutcome = 'packed' | 'not_packed';

export interface InventoryPackPort {
  pack(body: OrderPackBody): Promise<OrderPackOutcome>;
}

/** Inventory's hosted route accepts at most this many tickets per stock.pack_all. */
export const ORDER_PACK_MAX_TICKETS = 100;

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Exact Inventory pack body. One ticket is stock.pack; every ticket is
 * stock.pack_all. No order number. The command id is a digest of the command,
 * so a retried click replays Inventory's stored result instead of packing twice.
 */
export async function orderPackBody(ticketIds: readonly string[] | undefined): Promise<OrderPackBody | null> {
  if (!ticketIds?.length || ticketIds.length > ORDER_PACK_MAX_TICKETS) return null;
  if (new Set(ticketIds).size !== ticketIds.length) return null;
  if (ticketIds.some(id => typeof id !== 'string' || !id || id !== id.trim() || id.length > 200)) return null;
  if (ticketIds.length === 1) {
    return { commandId: 'commerce.pack:' + await digest('stock.pack\n' + ticketIds[0]), type: 'stock.pack', reservationId: ticketIds[0] };
  }
  return {
    commandId: 'commerce.pack:' + await digest('stock.pack_all\n' + ticketIds.join('\n')),
    type: 'stock.pack_all', reservationIds: [...ticketIds],
  };
}

export interface InventoryPackTransportConfig {
  /** Bare https origin of the Inventory service, e.g. the store's configured provider origin. */
  inventoryOrigin: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Bearer credential for the signed-in Inventory account; Inventory derives site and pool from it. */
  credential: () => Promise<string>;
}

const MAX_RESPONSE_BYTES = 65536;

/** HTTP adapter for Inventory `POST /v1/stock/pack`. Never throws; unavailable is not packed. */
export function createInventoryPackTransport(config: InventoryPackTransportConfig): InventoryPackPort {
  return {
    async pack(body) {
      try {
        const origin = new URL(config.inventoryOrigin).origin;
        const token = await config.credential();
        if (typeof token !== 'string' || !token) return 'not_packed';
        const response = await config.fetch(origin + '/v1/stock/pack', {
          method: 'POST', cache: 'no-store', redirect: 'error',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify(body),
        });
        if (response.status !== 200) return 'not_packed';
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) return 'not_packed';
        const result = JSON.parse(text) as Record<string, unknown> | null;
        if (!result || typeof result !== 'object' || result.commandId !== body.commandId) return 'not_packed';
        const expected = body.type === 'stock.pack' ? 'packed' : 'packed_all';
        return result.outcome === expected ? 'packed' : 'not_packed';
      } catch {
        return 'not_packed';
      }
    },
  };
}
