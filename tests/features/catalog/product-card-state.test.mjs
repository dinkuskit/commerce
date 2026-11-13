import assert from 'node:assert/strict';
import test from 'node:test';
import { productCardFixture } from '../../helpers/product-card-fixture.mjs';

const cards = blocks => blocks.flatMap(block => block.type === 'accordion' ? [block, ...cards(block.blocks)] : []);
const shipping = answer => answer.blocks.find(block => block.label === 'Shipping');
const form = card => card.blocks.find(block => block.type === 'form');

for (const variants of [false, true]) test(`stable ${variants ? 'variant' : 'simple'} card identities survive error insertion and removal`, async () => {
  const fixture = await productCardFixture(variants);
  const initial = await fixture.invoke({ type: 'panel_load' });
  const ids = cards(initial.blocks).map(card => card.block_id);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
  const weightForm = form(shipping(initial));
  const values = Object.fromEntries(weightForm.fields.map((field, index) => [field.action_id, index ? '6.5' : '-1']));
  const before = fixture.snapshot();
  const refused = await fixture.invoke({ type: 'form_submit', action_id: weightForm.submit.action_id, values });
  assert.equal(refused.toast.type, 'error');
  assert.deepEqual(fixture.snapshot(), before);
  assert.deepEqual(cards(refused.blocks).map(card => card.block_id), ids);
  assert.equal(shipping(refused).default_open, true);
  assert.deepEqual(form(shipping(refused)).fields.map(field => field.initial_value), Object.values(values));
  const corrected = await fixture.invoke({ type: 'form_submit', action_id: form(shipping(refused)).submit.action_id,
    values: { ...values, [weightForm.fields[0].action_id]: '7' } });
  assert.equal(corrected.toast.type, 'success');
  assert.deepEqual(cards(corrected.blocks).map(card => card.block_id), ids);
  assert.equal(shipping(corrected).default_open, true);
});

test('card identities follow product/member identity, not mutable price labels', async () => {
  const fixture = await productCardFixture(true);
  const initial = await fixture.invoke({ type: 'panel_load' });
  const all = cards(initial.blocks);
  const variant = all.find(card => card.label === 'M · $20.00');
  const priceForm = form(variant);
  const values = Object.fromEntries(priceForm.fields.map(field => [field.action_id, field.initial_value ?? field.initial_option]));
  const changed = await fixture.invoke({ type: 'form_submit', action_id: priceForm.submit.action_id,
    values: { ...values, regular: '21', sale: '', stockStatus: 'in-stock' } });
  assert.equal(changed.toast.type, 'success');
  assert.equal(cards(changed.blocks).find(card => card.label === 'M · $21.00').block_id, variant.block_id);
  const other = await productCardFixture(true);
  const otherIds = cards((await other.invoke({ type: 'panel_load' })).blocks).map(card => card.block_id);
  assert.ok(all.every(card => !otherIds.includes(card.block_id)), 'another product never inherits the previous cards');
});
