import { fields } from '../../../shared/admin-blocks.js';
import type { Block, BlockResponse } from '@emdash-cms/blocks/server';
import type { PaidOrder } from '../../../handoffs/paid-order.js';
import { billingMatchesDelivery, billingOf, deliveryOf, type OrderRecord } from '../store.js';
import type { CheckoutDeliveryAddress } from '../../checkout-contact/index.js';
import { REGISTRY_BUILD } from '../../../shared/registry-build.js';
import type { Money } from '../../catalog/kernel/index.js';
import { normalizeMoney } from '../../catalog/kernel/index.js';

/** Read-only projection. The authenticated controller owns loading and authorization. */
export type OrdersInspection = { status: 'available'; orders: readonly OrderRecord[] } | { status: 'unavailable' };
function amount(value: Money | bigint): string {
  const minor = typeof value === 'bigint' ? value : BigInt(normalizeMoney(value).minor);
  return '$' + (minor / 100n).toLocaleString('en-US') + '.' + String(minor % 100n).padStart(2, '0');
}
/** Order times read in UTC until stores record a time zone. */
function when(at: string): string {
  return new Date(at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}
/** An address as the lines on a parcel, one wrapping section each. */
function lines(a: CheckoutDeliveryAddress): Block[] {
  return [a.name, [a.line1, a.line2].filter(Boolean).join(', '), a.city + ', ' + [a.region, a.postalCode].filter(Boolean).join(' '), a.country]
    .map(text);
}
function text(value: string): Block {
  return { type: 'section', text: value };
}
function payment(order: PaidOrder): string {
  if (order.paymentId) return 'Paid';
  return normalizeMoney(order.total).minor === '0' ? 'Nothing to pay' : 'Payment not recorded';
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
/** People read the short number; orders kept before numbering show their ID until the page numbers them. Only live orders are real. */
function label(record: OrderRecord): string {
  return (record.number === undefined ? record.paidOrder.orderId : '#' + record.number) + (record.paidOrder.mode === 'live' ? '' : ' (TEST)');
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
const notRecorded = 'Not recorded';
const back = action('Back to orders', 'orders.list');
/** Selection is the exact canonical order ID, never a row offset or payment ID. `labelPage` is Ship's page for the selected order. */
export function ordersView(input: OrdersInspection, selectedOrderId?: string, labelPage?: string): BlockResponse {
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
    const record = matches[0], order = record.paidOrder, done = record.completed, contact = order.contactSnapshot?.contact, billing = billingOf(record), ship = deliveryOf(record);
    const id = encodeURIComponent(order.orderId), version = (record.revision ?? 1) + ':' + id, pricing = order.pricing;
    // Packing first: what to send and where, then the action that finishes it.
    blocks.push({ type: 'header', text: 'Order ' + label(record) }, { type: 'context', text: [order.paidAt ? 'Paid ' + when(order.paidAt) : 'Paid', status(record),
      ...(done ? [when(done.at)] : [])].join(' · ') },
    ...(order.mode === 'live' ? [] : [{ type: 'banner', variant: 'alert', title: 'Test order', description: 'No money moved. Postage is never bought for a test order.' } as Block]),
    // A Completed order's address is locked; moving it back to Processing unlocks it.
    // A Processing order with an address links to Ship's label page when the store has Ship.
    { type: 'actions', elements: done
      ? [{ type: 'button', label: 'Move back to Processing', action_id: 'orders.reopen:' + version,
        confirm: { title: 'Move back to Processing?', text: 'Its carrier, tracking number and completion time are cleared.', confirm: 'Move back', deny: 'Cancel' } }]
      : [...(labelPage && ship ? [{ type: 'link' as const, label: 'Create shipping label', target: { kind: 'external' as const, url: labelPage }, appearance: 'primary' as const }] : []),
        { type: 'button', label: 'Complete order', action_id: 'orders.finish:' + id, ...(labelPage && ship ? {} : { style: 'primary' as const }) },
        ...(ship ? [{ type: 'button' as const, label: 'Correct address', action_id: 'orders.address:' + id }] : [])] });
    // Pack asks Inventory to pack the tickets reserve minted; it never marks the order packed here.
    // Reserve mints tickets only through an Inventory provider, which the Registry build never has.
    if (!REGISTRY_BUILD && order.ticketIds?.length) blocks.push(action('Pack', 'orders.pack:' + id));
    blocks.push({ type: 'header', text: 'Items' }, { type: 'table', page_action_id: 'orders.items', columns: [
      { key: 'item', label: 'Item' }, { key: 'options', label: 'Options' }, { key: 'quantity', label: 'Qty' }, { key: 'total', label: 'Total' }],
    rows: order.lines.map(line => ({ item: line.name, quantity: String(line.quantity),
      options: order.variantSelections?.find(selection => selection.catalogItemId === line.catalogItemId)?.selections
        .map(choice => choice.optionLabel + ': ' + choice.valueLabel).join(' · ') ?? '',
      total: amount(BigInt(normalizeMoney(line.unitPrice).minor) * BigInt(line.quantity)) })) } as Block);
    const payments: Block[] = [{ type: 'header', text: 'Payment' }, { type: 'table', page_action_id: 'orders.items', columns: [{ key: 'name', label: payment(order) }, { key: 'value', label: 'Amount' }],
      rows: [...(pricing ? [['Subtotal', amount(pricing.merchandiseSubtotal)],
        ...(pricing.coupon ? [['Coupon ' + pricing.coupon.code, '−' + amount(pricing.couponDiscount)]] : []),
        ['Shipping', amount(pricing.shipping.charge)]] : []), ['Total', amount(order.total)]].map(([name, value]) => ({ name, value })) } as Block];
    const left: Block[] = [{ type: 'header', text: 'Ship to' }, ...(ship ? lines(ship) : [text('No ship-to address')]),
      ...(record.delivery ? [{ type: 'context', text: 'Corrected after checkout' } as Block] : []),
      ...(done ? [{ type: 'header', text: 'Shipped' } as Block, text(done.carrier ?? 'Carrier not recorded'), text(done.tracking ?? 'No tracking number')] : [])];
    const right: Block[] = [{ type: 'header', text: 'Customer' }, text(contact?.email ?? 'No email'), text(contact?.phone ?? 'No phone'),
      // Orders paid before billing was recorded have none.
      { type: 'header', text: 'Bill to' }, ...(billingMatchesDelivery(record) ? [text('Same as ship-to')] : billing ? lines(billing) : [text(notRecorded)])];
    blocks.push({ type: 'columns', columns: [left, right] }, ...payments, { type: 'accordion', label: 'Order record', blocks: [
      text('Order ID: ' + order.orderId), text('Version: ' + (record.revision ?? 1)), text('Receipt: ' + order.receiptId),
      text('Checkout attempt: ' + order.attemptId), text('Provider payment: ' + (order.paymentId ?? notRecorded)),
      ...order.lines.map(line => text(line.name + ': ' + line.catalogItemId))] } as Block);
    return { blocks };
  } catch {
    return { blocks: [header(), back, unavailable('Orders unavailable', 'Recorded amounts could not be displayed safely.')] };
  }
}
