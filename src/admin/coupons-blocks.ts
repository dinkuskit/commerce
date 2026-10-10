import { adminAuthorized, pageOffset, pagination, navigation, fields } from '../shared/admin-blocks.js';
import type { Block, BlockResponse } from '@emdash-cms/blocks/server';
import type { PluginContext, SandboxedRouteContext } from 'emdash/plugin';
import { CouponAdminError, type CouponCollection, type CouponRecord } from '../features/coupons/index.js';
import { createCouponAdminPorts, createCoupon, disableCoupon, editCoupon, listCoupons } from './coupons-controller.js';
import type { CouponBasicForm } from './coupons-contract.js';
import { couponText } from './coupon-i18n.js';

type Text = ReturnType<typeof couponText>;
const PAGE_SIZE = 25;
const EMPTY: CouponBasicForm = { code: '', discountKind: 'percentage', discountValue: '', usageLimit: '', startsAt: '', endsAt: '', timeZone: '' };

export function couponInteraction(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return value.page === '/coupons' || (typeof value.action_id === 'string' && value.action_id.startsWith('coupon.'));
}
function form(action: string, values: CouponBasicForm, t: Text): Block {
  return { type: 'form', block_id: 'coupon-' + crypto.randomUUID(), fields: [
    { type: 'text_input', action_id: 'code', label: t('Code'), initial_value: values.code },
    { type: 'select', action_id: 'discountKind', label: t('Discount'), initial_value: values.discountKind,
      options: [{ label: t('Percentage'), value: 'percentage' }, { label: t('Fixed amount (USD)'), value: 'fixed' }] },
    { type: 'text_input', action_id: 'discountValue', label: t('Discount value'), initial_value: values.discountValue },
    { type: 'text_input', action_id: 'usageLimit', label: t('Usage limit'), initial_value: values.usageLimit },
    { type: 'text_input', action_id: 'startsAt', label: t('Starts at (ISO offset)'), initial_value: values.startsAt },
    { type: 'text_input', action_id: 'endsAt', label: t('Ends at (ISO offset, exclusive)'), initial_value: values.endsAt },
    { type: 'text_input', action_id: 'timeZone', label: t('Merchant timezone (IANA)'), initial_value: values.timeZone },
  ], submit: { label: action.startsWith('coupon.create:') ? t('Create coupon') : t('Save coupon'), action_id: action } };
}
function valuesOf(coupon: CouponRecord): CouponBasicForm {
  const discount = coupon.rule.discount;
  const amount = discount.kind === 'fixed' ? BigInt(discount.amount.minor) : null;
  return { code: coupon.code, discountKind: discount.kind,
    discountValue: amount === null ? String(discount.kind === 'percentage' ? discount.basisPoints / 100 : 0)
      : `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`,
    usageLimit: String(coupon.globalCap), startsAt: coupon.rule.startsAt, endsAt: coupon.rule.endsAt, timeZone: coupon.rule.timeZone };
}
function draftOf(raw: unknown): CouponBasicForm {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CouponAdminError('INVALID_INPUT', 'Coupon form is invalid');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== Object.keys(EMPTY).length || !Object.keys(EMPTY).every(key => typeof value[key] === 'string' && (value[key] as string).length <= 1024) ||
      !['percentage', 'fixed'].includes(value.discountKind as string)) throw new CouponAdminError('INVALID_INPUT', 'Coupon form is invalid');
  return value as unknown as CouponBasicForm;
}
function identity(action: string, kind: 'save' | 'disable') {
  const match = (kind === 'save' ? /^coupon\.save:([^:]+):([1-9]\d*)$/ : /^coupon\.disable:([^:]+):([1-9]\d*)$/).exec(action);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new CouponAdminError('INVALID_INPUT', 'Coupon revision is invalid');
  return { couponId: match[1], expectedRevision: Number(match[2]) };
}
function lifecycle(coupon: CouponRecord, t: Text) {
  return coupon.disabled ? t('Disabled') : Date.now() < Date.parse(coupon.rule.startsAt) ? t('Upcoming')
    : Date.now() >= Date.parse(coupon.rule.endsAt) ? t('Expired') : t('Active');
}

export async function couponBlocks(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const t = couponText(route);
  if (!adminAuthorized(route)) return { blocks: [{ type: 'banner', variant: 'error', title: t('Coupons require plugins:manage') }],
    toast: { type: 'error', message: t('Coupons require plugins:manage') } };
  const ports = createCouponAdminPorts({ coupons: ctx.storage.coupons as CouponCollection });
  let selectedId: string | null = null;
  let offset = 0;
  let draft: CouponBasicForm | undefined;
  let action = 'coupon.create:new';
  let failure: string | undefined;
  let success: string | undefined;
  let stale = false;
  const input = route.input as Record<string, unknown>;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid interaction');
    if (input.type === 'page_load') {
      if (input.page !== '/coupons') throw new Error('Invalid page');
    } else if (input.type === 'block_action') {
      if (input.action_id === 'coupon.open') {
        if (typeof input.value !== 'string' || !input.value) throw new Error('Invalid coupon');
        selectedId = input.value;
      } else if (input.action_id === 'coupon.list') {
        if (!Number.isSafeInteger(input.value) || (input.value as number) < 0 || (input.value as number) > 100000) throw new Error('Invalid page');
        offset = input.value as number;
      } else if (typeof input.action_id === 'string' && input.action_id.startsWith('coupon.disable:')) {
        const id = identity(input.action_id, 'disable');
        selectedId = id.couponId;
        await disableCoupon(ports, id.couponId, id.expectedRevision);
        success = t('Coupon disabled');
      } else if (input.action_id !== 'coupon.new') throw new Error('Invalid action');
    } else if (input.type === 'form_submit') {
      if (typeof input.action_id !== 'string') throw new Error('Invalid action');
      action = input.action_id;
      draft = draftOf(input.values);
      if (action === 'coupon.create:new') {
        selectedId = (await createCoupon(ports, draft)).couponId;
        success = t('Coupon created');
      } else {
        const id = identity(action, 'save');
        selectedId = id.couponId;
        await editCoupon(ports, { ...draft, ...id });
        success = t('Coupon saved');
      }
      draft = undefined;
    } else throw new Error('Invalid interaction');
  } catch (error) {
    stale = error instanceof CouponAdminError && error.code === 'REVISION_CONFLICT';
    failure = error instanceof CouponAdminError ? t('Coupon changes were not saved. {reason}', { reason: error.message }) : t('Could not complete the request. Reload and try again.');
  }
  const blocks: Block[] = [{ type: 'header', text: t('Coupons') }, navigation(t('Products'), t('Settings'), t('Coupons')), ...(failure ? [{ type: 'banner' as const, variant: 'error' as const, title: failure }] : [])];
  try {
    const listed = await listCoupons(ports);
    const selected = selectedId ? listed.find(item => item.coupon.couponId === selectedId) : undefined;
    if (selectedId && !selected) throw new CouponAdminError('NOT_FOUND', 'Coupon was not found');
    if (!listed.length) blocks.push({ type: 'empty', title: t('No coupons yet'), description: t('Create your first coupon below.') });
    offset = pageOffset(offset, listed.length);
    for (const item of listed.slice(offset, offset + PAGE_SIZE)) {
      blocks.push({ type: 'section', text: t('{code} — {state} — {consumed} consumed / {remaining} remaining', {
        code: item.coupon.code, state: lifecycle(item.coupon, t), consumed: item.counts?.consumed ?? 0, remaining: item.counts?.remaining ?? 0 }),
        accessory: { type: 'button', label: t('Open {code}', { code: item.coupon.code }), action_id: 'coupon.open', value: item.coupon.couponId } });
    }
    pagination(blocks, offset, listed.length, 'coupon.list', t('Previous'), t('Next'));
    blocks.push({ type: 'divider' }, { type: 'header', text: selected ? t('Edit coupon') : t('Create coupon') },
      { type: 'context', text: t('Dates require an explicit offset. End is exclusive. Percentage values are 0–100; fixed values are USD.') });
    if (selected) {
      if (!draft) action = `coupon.save:${selected.coupon.couponId}:${selected.coupon.revision}`;
      if (selected.counts) blocks.push(fields(
        t('Consumed redemptions'), String(selected.counts.consumed), t('Pending holds'), String(selected.counts.pending),
        t('Released attempts'), String(selected.counts.released), t('Remaining capacity'), String(selected.counts.remaining),
      ));
      if (stale) blocks.push({ type: 'context', text: t('This coupon changed. Reopen it to review current values before saving.') });
      if (!selected.coupon.disabled && !stale) blocks.push({ type: 'actions', elements: [{ type: 'button', label: t('Disable coupon'),
        action_id: `coupon.disable:${selected.coupon.couponId}:${selected.coupon.revision}`, style: 'danger',
        confirm: { title: t('Disable coupon?'), text: t('New redemptions will be refused.'), confirm: t('Disable'), deny: t('Keep enabled'), style: 'danger' } }] });
    }
    blocks.push(form(action, draft ?? (selected ? valuesOf(selected.coupon) : EMPTY), t));
    blocks.push({ type: 'actions', elements: [{ type: 'button', label: t('New coupon'), action_id: 'coupon.new' }] });
  } catch {
    failure ??= t('Coupons are unavailable. Reload and try again.');
    blocks.push({ type: 'banner', variant: 'error', title: failure });
    if (draft) blocks.push(form(action, draft, t));
  }
  return { blocks, ...(failure ? { toast: { type: 'error' as const, message: failure } } : success ? { toast: { type: 'success' as const, message: success } } : {}) };
}
