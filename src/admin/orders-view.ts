import type { Block, BlockResponse } from '@emdash-cms/blocks/server';
import type { CommerceOrder } from '../features/checkout/types.js';
import type { Money } from '../features/catalog/types.js';
import { normalizeMoney } from '../features/catalog/money.js';

/** Read-only projection. The eventual authenticated controller owns loading and authorization. */
export type OrdersInspection = { status: 'available'; orders: readonly CommerceOrder[] } | { status: 'unavailable' };
function amount(value: Money): string {
  const minor = BigInt(normalizeMoney(value).minor);
  return 'USD ' + (minor / 100n) + '.' + String(minor % 100n).padStart(2, '0');
}
function payment(order: CommerceOrder): string {
  if (order.paymentId) return 'Provider-paid';
  return normalizeMoney(order.total).minor === '0' ? 'Zero payable — no payment required' : 'Payment not recorded';
}
const back: Block = { type: 'actions', elements: [{ type: 'button', label: 'Back to orders', action_id: 'orders.list' }] };
/** Selection is the exact canonical order ID, never a row offset or payment ID. */
export function ordersView(input: OrdersInspection, selectedOrderId?: string): BlockResponse {
  const blocks: Block[] = [{ type: 'header', text: 'Orders' }];
  if (selectedOrderId !== undefined) blocks.push(back);
  if (input.status === 'unavailable') return { blocks: [...blocks, { type: 'banner', variant: 'error', title: 'Orders unavailable', description: 'Order records could not be loaded. Try again.' }] };
  try {
    if (selectedOrderId === undefined) {
      if (!input.orders.length) blocks.push({ type: 'section', text: 'No orders recorded yet.' });
      for (const order of input.orders) blocks.push(
        { type: 'fields', fields: [{ label: 'Order', value: order.orderId }, { label: 'Total', value: amount(order.total) }, { label: 'Payment', value: payment(order) }, { label: 'Fulfillment', value: 'Not recorded' }] },
        { type: 'actions', elements: [{ type: 'button', label: 'Inspect ' + order.orderId, action_id: 'orders.open:' + encodeURIComponent(order.orderId) }] },
        { type: 'divider' },
      );
      return { blocks };
    }
    const matches = input.orders.filter(order => order.orderId === selectedOrderId);
    if (matches.length !== 1) return { blocks: [...blocks, { type: 'banner', variant: 'error', title: 'Order unavailable', description: 'The selected order could not be identified.' }] };
    const order = matches[0];
    blocks.push({ type: 'fields', fields: [
      { label: 'Order', value: order.orderId }, { label: 'Receipt', value: order.receiptId },
      { label: 'Checkout attempt', value: order.attemptId }, { label: 'Payment', value: payment(order) },
      { label: 'Provider payment', value: order.paymentId ?? 'Not recorded' }, { label: 'Fulfillment', value: 'Not recorded' },
    ] }, { type: 'header', text: 'Items' });
    for (const line of order.lines) blocks.push({ type: 'fields', fields: [
      { label: 'Item', value: line.name }, { label: 'Catalog ID', value: line.catalogItemId },
      { label: 'Quantity', value: String(line.quantity) }, { label: 'Unit price', value: amount(line.unitPrice) },
    ] });
    if (order.pricing) {
      const pricing = order.pricing;
      blocks.push({ type: 'header', text: 'Recorded pricing' }, { type: 'fields', fields: [
        { label: 'Item subtotal', value: amount(pricing.merchandiseSubtotal) },
        { label: 'Coupon', value: pricing.coupon?.code ?? 'None recorded' },
        { label: 'Coupon discount', value: amount(pricing.couponDiscount) },
        { label: 'Net items', value: amount(pricing.netMerchandise) },
        { label: 'Shipping', value: amount(pricing.shipping.charge) },
        { label: 'Pricing total', value: amount(pricing.finalTotal) },
      ] });
    } else blocks.push({ type: 'context', text: 'Item subtotal, coupon and shipping breakdown not recorded.' });
    blocks.push({ type: 'fields', fields: [{ label: 'Order total', value: amount(order.total) }] });
    return { blocks };
  } catch {
    return { blocks: [{ type: 'header', text: 'Orders' }, back, { type: 'banner', variant: 'error', title: 'Orders unavailable', description: 'Recorded amounts could not be displayed safely.' }] };
  }
}
