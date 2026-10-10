import { adminAuthorized, pageOffset, pagination } from '../../../shared/admin-blocks.js';
import type { Block, BlockResponse } from '@emdash-cms/blocks/server';
import type { PluginContext, SandboxedRouteContext } from 'emdash/plugin';
import type { PaidOrder } from '../../../handoffs/paid-order.js';
import { createPaidOrderReceiver, listOrders, ORDERS_COLLECTION, type OrdersCollection } from '../store.js';
import { ordersView } from './view.js';
import { orderPackBody, type InventoryPackPort } from '../pack.js';

/** Host-wired services. Without a pack port, Pack reports Not packed and writes nothing. */
export interface OrdersServices {
  pack?: InventoryPackPort;
  /** Checkout's paid orders, so Orders can bring in copies it is missing. */
  paidOrders?: () => Promise<readonly PaidOrder[]>;
}

export function ordersInteraction(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const value = input as Record<string, unknown>;
  return value.page === '/orders' || (typeof value.action_id === 'string' && value.action_id.startsWith('orders.'));
}

/** Asks Checkout for its paid orders and keeps a copy of each one Orders lacks. */
async function bringIn(collection: OrdersCollection, services: OrdersServices): Promise<Block[]> {
  const receiver = createPaidOrderReceiver(collection);
  let stored = 0, conflicts = 0;
  for (const order of await services.paidOrders!()) {
    const outcome = await receiver.receive(order);
    if (outcome === 'stored') stored++;
    if (outcome === 'conflict') conflicts++;
  }
  return [
    { type: 'banner', variant: 'default', title: stored ? 'Brought in ' + stored + ' missing order' + (stored === 1 ? '' : 's') : 'No missing orders' },
    ...(conflicts ? [{ type: 'banner' as const, variant: 'error' as const, title: conflicts + ' order' + (conflicts === 1 ? ' differs' : 's differ') + ' from Checkout', description: 'Orders kept its first copy.' }] : []),
  ];
}

export async function ordersBlocks(route: SandboxedRouteContext, ctx: PluginContext, services: OrdersServices = {}): Promise<BlockResponse> {
  if (!adminAuthorized(route)) return { blocks: [{ type: 'banner', variant: 'error', title: 'Orders require plugins:manage' }] };
  let selected: string | undefined;
  let pack = false;
  let offset = 0;
  try {
    const input = route.input as Record<string, unknown>;
    const collection = ctx.storage[ORDERS_COLLECTION] as OrdersCollection;
    let notices: Block[] = [];
    if (input.type === 'page_load' && input.page === '/orders') {}
    else if (input.type === 'block_action' && input.action_id === 'orders.import' && services.paidOrders) notices = await bringIn(collection, services);
    else if (input.type === 'block_action' && input.action_id === 'orders.list') {
      if (input.value !== undefined) {
        if (!Number.isSafeInteger(input.value) || (input.value as number) < 0) throw new Error('Invalid page');
        offset = input.value as number;
      }
    } else if (input.type === 'block_action' && typeof input.action_id === 'string' && (input.action_id.startsWith('orders.open:') || input.action_id.startsWith('orders.pack:'))) {
      pack = input.action_id.startsWith('orders.pack:');
      selected = decodeURIComponent(input.action_id.slice(12));
      if (!selected || selected.length > 1024) throw new Error('Invalid order');
    } else throw new Error('Invalid interaction');
    let orders = await listOrders(collection);
    // Orders paid before Orders kept its own copies come over the first time the page finds none.
    if (!orders.length && services.paidOrders && !notices.length) {
      await bringIn(collection, services);
      orders = await listOrders(collection);
    } else if (notices.length) orders = await listOrders(collection);
    if (selected !== undefined) {
      const view = ordersView({ status: 'available', orders }, selected);
      if (!pack) return view;
      const order = orders.find(item => item.orderId === selected);
      const body = await orderPackBody(order?.ticketIds);
      if (!body) throw new Error('Pack unavailable');
      // Orders stores nothing either way; Inventory's ticket state is the record.
      const outcome = services.pack ? await services.pack.pack(body) : 'not_packed';
      view.blocks.push(outcome === 'packed'
        ? { type: 'banner', variant: 'default', title: 'Packed in Inventory', description: 'Inventory packed ' + (body.type === 'stock.pack' ? 'the ticket' : 'every ticket') + ' for this order. No label was bought and nothing is marked delivered.' }
        : { type: 'banner', variant: 'error', title: 'Not packed', description: services.pack
          ? 'Inventory did not confirm Pack. The order is not marked packed; check Inventory and retry.'
          : 'Inventory Pack is not connected for this store. The order is not marked packed.' });
      return view;
    }
    offset = pageOffset(offset, orders.length);
    const response = ordersView({ status: 'available', orders: orders.slice(offset, offset + 25) });
    response.blocks.splice(1, 0, ...notices);
    if (services.paidOrders) response.blocks.push({ type: 'actions', elements: [{ type: 'button', label: 'Bring in missing orders', action_id: 'orders.import' }] });
    pagination(response.blocks, offset, orders.length, 'orders.list');
    return response;
  } catch { return ordersView({ status: 'unavailable' }, selected); }
}
