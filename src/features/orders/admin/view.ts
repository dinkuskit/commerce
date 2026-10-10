import { fields } from '../../../shared/admin-blocks.js';
import type { Block, BlockResponse } from '@emdash-cms/blocks/server';
import type { PaidOrder } from '../../../handoffs/paid-order.js';
import { deliveryOf, type OrderRecord } from '../store.js';
import type { Money } from '../../catalog/kernel/index.js';
import { normalizeMoney } from '../../catalog/kernel/index.js';

/** Read-only projection. The authenticated controller owns loading and authorization. */
export type OrdersInspection = { status: 'available'; orders: readonly OrderRecord[] } | { status: 'unavailable' };
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
// Digital-only orders and orders paid before addresses were collected have none;
// copies kept before Orders checked the contact snapshot may lack its contact.
function shipTo(record: OrderRecord): string {
  const a = deliveryOf(record);
  return a ? [a.name, a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ') + (record.delivery ? ' (corrected)' : '') : 'No address';
}
/** People read the short number; orders kept before numbering show their ID until the page numbers them. */
function label(record: OrderRecord): string {
  return record.number === undefined ? record.paidOrder.orderId : '#' + record.number;
}
/** Processing until the order ships; Completed means shipped, never delivered. */
function status(record: OrderRecord): string {
  return record.completed ? 'Completed' : 'Processing';
}
/** An owner form for one order, bound to the version it was opened at so a stale save changes nothing. */
function orderForm(record: OrderRecord, title: string, failure: string | undefined, refused: string, fields: [string, string, string?][], submit: string, verb: string): BlockResponse {
  const id = encodeURIComponent(record.paidOrder.orderId);
  return { blocks: [header(), action('Back to order', 'orders.open:' + id), { type: 'header', text: title + ' ' + label(record) },
    ...(failure ? [unavailable(refused, failure)] : []),
    { type: 'form', block_id: 'order-' + verb + '-' + crypto.randomUUID(), fields: fields.map(([action_id, label, initial_value]) =>
      ({ type: 'text_input', action_id, label, initial_value })),
    submit: { label: submit, action_id: 'orders.' + verb + ':' + (record.revision ?? 1) + ':' + id } } as Block] };
}
const ADDRESS_LABELS = { name: 'Name', line1: 'Address line 1', line2: 'Address line 2', city: 'City', region: 'State or region', postalCode: 'ZIP or postal code', country: 'Country code' };
/** The owner's address correction form, filled with the current address. */
export function addressForm(record: OrderRecord, failure?: string, typed?: Record<string, unknown>): BlockResponse {
  const a = (typed ?? deliveryOf(record)) as Record<string, string>;
  return orderForm(record, 'Correct the address for', failure, 'Address not saved',
    Object.entries(ADDRESS_LABELS).map(([key, name]) => [key, name, String(a[key] ?? '')]), 'Save address', 'save');
}
/** Completing by hand: carrier and tracking number are optional. */
export function completeForm(record: OrderRecord, failure?: string, typed?: Record<string, unknown>): BlockResponse {
  return orderForm(record, 'Complete', failure, 'Order not completed', [['carrier', 'Carrier (optional)', String(typed?.carrier ?? '')],
    ['tracking', 'Tracking number (optional)', String(typed?.tracking ?? '')]], 'Complete order', 'complete');
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
      for (const record of input.orders) blocks.push(
        fields('Order', label(record), 'Total', amount(record.paidOrder.total), 'Payment', payment(record.paidOrder), 'Status', status(record)),
        action('Inspect ' + label(record), 'orders.open:' + encodeURIComponent(record.paidOrder.orderId)),
        { type: 'divider' },
      );
      return { blocks };
    }
    const matches = input.orders.filter(record => record.paidOrder.orderId === selectedOrderId);
    if (matches.length !== 1) return { blocks: [...blocks, unavailable('Order unavailable', 'The selected order could not be identified.')] };
    const record = matches[0], order = record.paidOrder, done = record.completed;
    const id = encodeURIComponent(order.orderId), version = (record.revision ?? 1) + ':' + id;
    blocks.push(detailFields('Order', label(record), 'Order ID', order.orderId, 'Version', String(record.revision ?? 1), 'Receipt', order.receiptId,
      'Checkout attempt', order.attemptId, 'Payment', payment(order),
      'Provider payment', order.paymentId ?? notRecorded, 'Paid at', order.paidAt ?? notRecorded, 'Status', status(record),
      ...(done ? ['Completed at', done.at, 'Carrier', done.carrier ?? notRecorded, 'Tracking number', done.tracking ?? notRecorded] : []),
      'Ship to', shipTo(record)));
    // A Completed order's address is locked; moving it back to Processing unlocks it.
    blocks.push({ type: 'actions', elements: done
      ? [{ type: 'button', label: 'Move back to Processing', action_id: 'orders.reopen:' + version,
        confirm: { title: 'Move back to Processing?', text: 'Its carrier, tracking number and completion time are cleared.', confirm: 'Move back', deny: 'Cancel' } }]
      : [{ type: 'button', label: 'Complete order', action_id: 'orders.finish:' + id },
        ...(deliveryOf(record) ? [{ type: 'button' as const, label: 'Correct address', action_id: 'orders.address:' + id }] : [])] });
    blocks.push({ type: 'header', text: 'Items' });
    // Pack asks Inventory to pack the tickets reserve minted; it never marks the order packed here.
    if (order.ticketIds?.length) blocks.push(action('Pack', 'orders.pack:' + id));
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
