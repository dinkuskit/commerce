import { fields } from '../../../shared/admin-blocks.js';
import type { Block, BlockResponse } from '@emdash-cms/blocks/server';
import type { PaidOrder } from '../../../handoffs/paid-order.js';
import type { Money } from '../../catalog/kernel/index.js';
import { normalizeMoney } from '../../catalog/kernel/index.js';

/** Read-only projection. The authenticated controller owns loading and authorization. */
export type OrdersInspection = { status: 'available'; orders: readonly PaidOrder[] } | { status: 'unavailable' };
function amount(value: Money): string {
  const minor = BigInt(normalizeMoney(value).minor);
  return 'USD ' + (minor / 100n) + '.' + String(minor % 100n).padStart(2, '0');
}
function payment(order: PaidOrder): string {
  if (order.paymentId) return 'Provider-paid';
  return normalizeMoney(order.total).minor === '0' ? 'Zero payable — no payment required' : 'Payment not recorded';
}
// Keep repeated Block Kit wire keys in one place: this view ships in the backend.
function action(label: string, action_id: string): Block {
  return { type: 'actions', elements: [{ type: 'button', label, action_id }] };
}
function unavailable(title: string, description: string): Block {
  return { type: 'banner', variant: 'error', title, description };
}
function header(): Block {
  return { type: 'header', text: 'Orders' };
}
// Digital-only orders and orders paid before addresses were collected have none.
function shipTo(order: PaidOrder): string {
  const a = order.contactSnapshot?.contact.delivery;
  return a ? [a.name, a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ') : 'No address';
}
function detailFields(...pairs: string[]): Block {
  return { type: 'section', text: pairs.map((value, i) => i % 2 ? value : value + ':').join('\n') };
}
const notRecorded = 'Not recorded';
const back = action('Back to orders', 'orders.list');
/** Selection is the exact canonical order ID, never a row offset or payment ID. */
export function ordersView(input: OrdersInspection, selectedOrderId?: string): BlockResponse {
  const blocks: Block[] = [header()];
  if (selectedOrderId !== undefined) blocks.push(back);
  if (input.status === 'unavailable') return { blocks: [...blocks, unavailable('Orders unavailable', 'Order records could not be loaded. Try again.')] };
  try {
    if (selectedOrderId === undefined) {
      if (!input.orders.length) blocks.push({ type: 'section', text: 'No orders recorded yet.' });
      for (const order of input.orders) blocks.push(
        fields('Order', order.orderId, 'Total', amount(order.total), 'Payment', payment(order), 'Fulfillment', notRecorded),
        action('Inspect ' + order.orderId, 'orders.open:' + encodeURIComponent(order.orderId)),
        { type: 'divider' },
      );
      return { blocks };
    }
    const matches = input.orders.filter(order => order.orderId === selectedOrderId);
    if (matches.length !== 1) return { blocks: [...blocks, unavailable('Order unavailable', 'The selected order could not be identified.')] };
    const order = matches[0];
    blocks.push(detailFields('Order', order.orderId, 'Receipt', order.receiptId,
      'Checkout attempt', order.attemptId, 'Payment', payment(order),
      'Provider payment', order.paymentId ?? notRecorded, 'Paid at', order.paidAt ?? notRecorded, 'Fulfillment', notRecorded,
      'Ship to', shipTo(order)), { type: 'header', text: 'Items' });
    // Pack asks Inventory to pack the tickets reserve minted; it never marks the order packed here.
    if (order.ticketIds?.length) blocks.push(action('Pack', 'orders.pack:' + encodeURIComponent(order.orderId)));
    for (const line of order.lines) blocks.push(fields('Item', line.name, 'Catalog ID', line.catalogItemId,
      'Quantity', String(line.quantity), 'Unit price', amount(line.unitPrice)));
    if (order.pricing) {
      const pricing = order.pricing;
      blocks.push({ type: 'header', text: 'Recorded pricing' }, fields('Item subtotal', amount(pricing.merchandiseSubtotal),
        'Coupon', pricing.coupon?.code ?? 'None recorded',
        'Coupon discount', amount(pricing.couponDiscount),
        'Net items', amount(pricing.netMerchandise),
        'Shipping', amount(pricing.shipping.charge),
        'Pricing total', amount(pricing.finalTotal)));
    } else blocks.push({ type: 'context', text: 'Item subtotal, coupon and shipping breakdown not recorded.' });
    blocks.push(fields('Order total', amount(order.total)));
    return { blocks };
  } catch {
    return { blocks: [header(), back, unavailable('Orders unavailable', 'Recorded amounts could not be displayed safely.')] };
  }
}
