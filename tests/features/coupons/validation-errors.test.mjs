import assert from 'node:assert/strict';
import test from 'node:test';
import { CouponRecordValidationError, validateCouponQuoteSnapshot, validateCouponRecord } from '../../../dist/features/coupons/validation.js';

const money = minor => ({ currency: 'USD', minor });
const quote = () => ({
  quoteId: 'quote', couponId: 'coupon', ruleId: 'rule', ruleVersion: 1,
  eligibleSubtotal: money('100'), discount: money('10'),
  payableMerchandiseTotal: money('90'), merchandiseTotal: money('100'), overallPayableTotal: money('90'),
  lines: [{ productId: 'item', quantity: 1, eligible: true, unitPrice: money('100'), lineSubtotal: money('100'), discount: money('10') }],
});
const error = message => value => {
  assert.ok(value instanceof CouponRecordValidationError);
  assert.equal(value.name, 'CouponRecordValidationError');
  assert.equal(value.message, message);
  return true;
};

test('coupon validation preserves nested field messages and first failure order', () => {
  const cases = [
    [line => { line.productId = ''; line.quantity = 0; }, 'productId must be non-empty'],
    [line => { line.quantity = 0; }, 'quantity must be a safe integer >= 1'],
    [line => { line.eligible = 'yes'; }, 'eligible is invalid'],
    [line => { line.lineSubtotal = money('99'); }, 'lineSubtotal must equal unitPrice * quantity'],
    [line => { line.discount = money('101'); }, 'discount must be between 0 and lineSubtotal'],
    [line => { line.eligible = false; }, 'discount must be 0 for ineligible line'],
  ];
  for (const [mutate, message] of cases) {
    const value = quote();
    mutate(value.lines[0]);
    assert.throws(() => validateCouponQuoteSnapshot(value, 'attempt.quote'), error(`attempt.quote.lines[0].${message}`));
  }
  const value = quote(); value.lines[0] = null;
  assert.throws(() => validateCouponQuoteSnapshot(value, 'attempt.quote'), error('attempt.quote.lines[0] is invalid'));
  assert.throws(() => validateCouponRecord(null), error('stored coupon must be an object'));
});
