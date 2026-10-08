import { hasPermission, toRoleLevel } from '@emdash-cms/auth';
import type { Block } from '@emdash-cms/blocks/server';
import type { SandboxedRouteContext } from 'emdash/plugin';

export function adminAuthorized(route: SandboxedRouteContext): boolean {
  try { return route.ui?.surface === 'admin-page' && !!route.user && hasPermission({ role: toRoleLevel(route.user.role) }, 'plugins:manage'); }
  catch { return false; }
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

export function navigation(products = 'Products', settings = 'Settings', coupons = 'Coupons'): Block {
  return { type: 'actions', elements: [
    { type: 'link', label: products, target: { kind: 'plugin-page', path: '/products' } },
    { type: 'link', label: settings, target: { kind: 'plugin-page', path: '/settings' } },
    { type: 'link', label: coupons, target: { kind: 'plugin-page', path: '/coupons' } },
  ] };
}
