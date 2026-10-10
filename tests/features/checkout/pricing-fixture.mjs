import { openStore, fixture, cart, syntheticDelivery } from './fixture.mjs';
import { createCheckoutCouponPort, createCouponAdmin, createCouponAttemptOwner } from '../../../dist/features/coupons/index.js';
import { createHostedCouponPort } from '../../../dist/features/checkout/index.js';
import { COUPON_SERVICE_ORIGIN, COUPON_SERVICE_PASS, couponServiceFake } from './coupon-service-fake.mjs';

/** COMMERCE_HOSTED_COUPONS=1 runs the same cases through the hosted coupon port. */
const hosted = process.env.COMMERCE_HOSTED_COUPONS === '1';

function checkoutCoupons(collection, execution) {
  if (!hosted) return { port: createCheckoutCouponPort(collection) };
  // The service keeps its own clock; here it follows the fixture's.
  const service = couponServiceFake(collection, { now: () => new Date(execution.now() * 1000).toISOString() });
  return { service, port: createHostedCouponPort({ origin: COUPON_SERVICE_ORIGIN, siteId: 'site', fetch: service.fetch,
    credential: async () => COUPON_SERVICE_PASS }) };
}

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
  const bound = checkoutCoupons(coupons, f.execution);
  f.execution.pricing = { coupons: bound.port, paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1', resolveShippingConfiguration: async () => ({
    configurationId: 'shipping-rule', revision: 1, mode: shipping === '0' ? 'free' : 'flat', amount: { currency: 'USD', minor: shipping },
  }) };
  return { ...f, coupons, coupon, admin, couponService: bound.service, owner: createCouponAttemptOwner(coupons), input: { contact: { email: 'pricing-fixture@example.test', delivery: syntheticDelivery }, lines: cart, couponCode: 'SAVE' } };
}
