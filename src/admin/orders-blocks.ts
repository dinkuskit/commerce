import { adminAuthorized, pageOffset, pagination } from './blocks.js';
import type { BlockResponse } from '@emdash-cms/blocks/server';
import type { PluginContext, SandboxedRouteContext } from 'emdash/plugin';
import type { StorageCollection } from 'emdash';
import type { CheckoutRecord, CommerceOrder } from '../features/checkout/kernel/index.js';
import { inventoryPackCommand } from './pack-order.js';
import { ordersView } from './orders-view.js';

export function ordersInteraction(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const value = input as Record<string, unknown>;
  return value.page === '/orders' || (typeof value.action_id === 'string' && value.action_id.startsWith('orders.'));
}
export async function ordersBlocks(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  if (!adminAuthorized(route)) return { blocks: [{ type: 'banner', variant: 'error', title: 'Orders require plugins:manage' }] };
  let selected: string | undefined, packing = false, offset = 0;
  try {
    const input = route.input as Record<string, unknown>;
    if (input.type === 'page_load' && input.page === '/orders') {}
    else if (input.type === 'block_action' && input.action_id === 'orders.list') {
      if (input.value !== undefined) {
        if (!Number.isSafeInteger(input.value) || (input.value as number) < 0) throw new Error('Invalid page');
        offset = input.value as number;
      }
    } else if (input.type === 'block_action' && typeof input.action_id === 'string' && (input.action_id.startsWith('orders.pack:') || input.action_id.startsWith('orders.open:'))) {
      packing = input.action_id.startsWith('orders.pack:');
      selected = decodeURIComponent(input.action_id.slice(12));
      if (!selected || selected.length > 1024) throw new Error('Invalid order');
    } else throw new Error('Invalid interaction');
    const collection = ctx.storage.checkout_carts as StorageCollection<CheckoutRecord>;
    const orders: CommerceOrder[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error('Order scan limit');
      const result = await collection.query({ limit: 100, cursor });
      for (const item of result.items) {
        if (!Array.isArray(item.data.attempts)) throw new Error('Invalid aggregate');
        for (const attempt of item.data.attempts) {
          if (!attempt.order) continue;
          const order = attempt.order;
          if (attempt.phase !== 'paid' || order.attemptId !== attempt.attemptId || !order.orderId || !order.receiptId || ids.has(order.orderId)) throw new Error('Invalid order');
          ids.add(order.orderId); orders.push(order);
        }
      }
      if (!result.hasMore) break;
      if (!result.cursor || cursors.has(result.cursor)) throw new Error('Invalid cursor');
      cursor = result.cursor; cursors.add(cursor);
    }
    orders.sort((a, b) => a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0);
    if (selected !== undefined) {
      const view = ordersView({ status: 'available', orders }, selected);
      if (packing && view.blocks[1]?.type === 'actions') {
        const command = inventoryPackCommand(orders.find(order => order.orderId === selected)?.inventoryHold);
        view.blocks.splice(2, 0, { type: 'banner', variant: 'error', title: 'Not packed', description: command ? 'No pack route.' : 'No ticket ids.' });
      }
      return view;
    }
    offset = pageOffset(offset, orders.length);
    const response = ordersView({ status: 'available', orders: orders.slice(offset, offset + 25) });
    pagination(response.blocks, offset, orders.length, 'orders.list');
    return response;
  } catch { return ordersView({ status: 'unavailable' }, selected); }
}
