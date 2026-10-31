import type { Block } from '@emdash-cms/blocks/server';
import type { SandboxedRouteContext } from 'emdash/plugin';

/** A trusted admin page opened by an Administrator, or by an Editor (40) where the screen allows staff. */
export function adminAuthorized(route: SandboxedRouteContext, role = 50): boolean {
  const level = route.user?.role;
  return route.ui?.surface === "admin-page" && typeof level === "number" && level >= role;
}
export function pageOffset(offset: number, count: number): number {
  return Math.min(offset, Math.max(0, Math.floor((count - 1) / 25) * 25));
}
export function pagination(blocks: Block[], offset: number, count: number, action_id: string, previous = 'Previous', next = 'Next'): void {
  const elements: { type: 'button'; label: string; action_id: string; value: number }[] = [];
  if (offset) elements.push({ type: 'button', label: previous, action_id, value: offset - 25 });
  if (offset + 25 < count) elements.push({ type: 'button', label: next, action_id, value: offset + 25 });
  if (elements.length) blocks.push({ type: 'actions', elements });
}
export function fields(...pairs: string[]): Block {
  const fields = [];
  for (let i = 0; i < pairs.length; i += 2) fields.push({ label: pairs[i], value: pairs[i + 1] });
  return { type: 'fields', fields };
}

/** The Coupons link renders only where a coupon admin page is mounted. */
export function navigation(orders = 'Orders', settings = 'Settings', coupons?: string): Block {
  return { type: 'actions', elements: [
    { type: 'link', label: orders, target: { kind: 'plugin-page', path: '/orders' } },
    { type: 'link', label: settings, target: { kind: 'plugin-page', path: '/settings' } },
    ...(coupons ? [{ type: 'link' as const, label: coupons, target: { kind: 'plugin-page' as const, path: '/coupons' } }] : []),
  ] };
}
