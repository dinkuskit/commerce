// Checkout's coupon cases again, with the coupon port bound to the hosted
// coupon service contract instead of local coupon storage.
process.env.COMMERCE_HOSTED_COUPONS = '1';
await import('./checkout-pricing-recovery.test.mjs');
