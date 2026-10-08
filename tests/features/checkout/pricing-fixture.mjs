import { openStore, fixture, cart } from './fixture.mjs';
import { createCheckoutCouponPort, createCouponAdmin, createCouponAttemptOwner } from '../../../dist/features/coupons/index.js';

export function couponCollection() {
  const records = new Map();
  return {
    records,
    async get(id) { return structuredClone(records.get(id)?.value ?? null); },
    async getVersioned(id) { return structuredClone(records.get(id) ?? null); },
    async put(id, value) { records.set(id, { revision: '1', value: structuredClone(value) }); },
    async query() { return { items: [...records].map(([id, r]) => ({ id, data: structuredClone(r.value) })), hasMore: false }; },
    async compareAndSet(id, revision, value) {
      const stored = records.get(id);
      if (!stored || stored.revision !== revision) return { applied: false };
      records.set(id, { revision: String(Number(revision) + 1), value: structuredClone(value) });
      return { applied: true };
    },
  };
}

export async function pricingFixture(t, { cap = 1, discount = { kind: 'fixed', amount: { currency: 'USD', minor: '100' } }, shipping = '50', managed = false } = {}) {
  const opened = openStore(':memory:');
  t.after(() => opened.db.close());
  const f = fixture(opened.store, managed);
  f.setNow(1791288000);
  f.execution.payments.pricingSchema = 'dinkuskit.commerce.checkout-pricing/v1';
  const coupons = couponCollection();
  const admin = createCouponAdmin(coupons);
  const coupon = await admin.create({
    code: 'SAVE', globalCap: cap,
    rule: { ruleId: 'totals-rule', version: 1, discount, appliesTo: 'all-merchandise', selectedProductIds: [], includeSaleItems: true,
      minimumEligibleMerchandise: { currency: 'USD', minor: '0' }, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', timeZone: 'UTC' },
  });
  f.execution.pricing = { coupons: createCheckoutCouponPort(coupons), paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1', resolveShippingConfiguration: async () => ({
    configurationId: 'shipping-rule', revision: 1, mode: shipping === '0' ? 'free' : 'flat', amount: { currency: 'USD', minor: shipping },
  }) };
  return { ...f, coupons, coupon, admin, owner: createCouponAttemptOwner(coupons), input: { lines: cart, couponCode: 'SAVE' } };
}
