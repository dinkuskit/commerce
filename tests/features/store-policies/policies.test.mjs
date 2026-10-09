import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductJsonLd,
  assertProductJsonLdShape,
} from '../../../dist/features/structured-data/index.js';
import {
  readPublicStorePoliciesFromStorage,
  setStoreReturnPolicy,
  setStoreShippingPolicy,
} from '../../../dist/features/store-policies/index.js';

function memory() {
  const rows = new Map();
  return {
    async get(id) {
      return rows.has(id) ? structuredClone(rows.get(id)) : null;
    },
    async put(id, value) {
      rows.set(id, structuredClone(value));
    },
    _rows: rows,
  };
}

test('unconfigured policies omit shippingDetails and return policy from JSON-LD', async () => {
  const shipping = memory();
  const returns = memory();
  const policies = await readPublicStorePoliciesFromStorage({ shipping, returns });
  assert.deepEqual(policies, { shipping: null, returns: null });
  const jsonLd = buildProductJsonLd({
    product: {
      id: 'hat',
      name: 'Hat',
      sku: 'HAT',
      price: { currency: 'USD', minor: '1000' },
      availability: { status: 'in-stock', sellable: true, listable: true },
    },
    page: { url: 'https://shop.example.test/p/hat' },
    policies,
  });
  assertProductJsonLdShape(jsonLd);
  assert.equal('shippingDetails' in jsonLd.offers, false);
  assert.equal('hasMerchantReturnPolicy' in jsonLd.offers, false);
});

test('policy page data and JSON-LD read the same shipping and return revisions', async () => {
  const shipping = memory();
  const returns = memory();
  const shipWrite = await setStoreShippingPolicy(shipping, {
    configurationId: 'cfg-1',
    mode: 'flat',
    amount: { currency: 'USD', minor: '799' },
    shippingDestinationCountries: ['US'],
    handlingTimeDays: { min: 1, max: 2 },
    transitTimeDays: { min: 3, max: 7 },
    policyPageUrl: 'https://shop.example.test/shipping',
  });
  assert.equal(shipWrite.changed, true);
  assert.equal(shipWrite.policy.revision, 1);

  const returnWrite = await setStoreReturnPolicy(returns, {
    applicableCountry: ['US'],
    returnPolicyCategory: 'MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 14,
    returnMethod: 'ReturnByMail',
    returnFees: 'ReturnShippingFees',
    policyPageUrl: 'https://shop.example.test/returns',
  });
  assert.equal(returnWrite.changed, true);
  assert.equal(returnWrite.policy.revision, 1);

  const pageData = await readPublicStorePoliciesFromStorage({ shipping, returns });
  assert.equal(pageData.shipping.revision, 1);
  assert.equal(pageData.returns.revision, 1);

  const jsonLd = buildProductJsonLd({
    product: {
      id: 'hat',
      name: 'Hat',
      sku: 'HAT',
      price: { currency: 'USD', minor: '1000' },
      availability: { status: 'in-stock', sellable: true, listable: true },
    },
    page: { url: 'https://shop.example.test/p/hat' },
    policies: pageData,
  });
  assertProductJsonLdShape(jsonLd);
  assert.equal(jsonLd.offers.shippingDetails.shippingRate.value, '7.99');
  assert.equal(jsonLd.offers.hasMerchantReturnPolicy.merchantReturnDays, 14);

  const shipUpdate = await setStoreShippingPolicy(shipping, {
    configurationId: 'cfg-1',
    mode: 'free',
    shippingDestinationCountries: ['US', 'CA'],
  });
  assert.equal(shipUpdate.policy.revision, 2);
  const returnUpdate = await setStoreReturnPolicy(returns, {
    applicableCountry: ['US'],
    returnPolicyCategory: 'MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 30,
    returnMethod: 'ReturnByMail',
    returnFees: 'FreeReturn',
    policyPageUrl: 'https://shop.example.test/returns',
  });
  assert.equal(returnUpdate.policy.revision, 2);

  const nextPage = await readPublicStorePoliciesFromStorage({ shipping, returns });
  const nextJsonLd = buildProductJsonLd({
    product: {
      id: 'hat',
      name: 'Hat',
      sku: 'HAT',
      price: { currency: 'USD', minor: '1000' },
      availability: { status: 'in-stock', sellable: true, listable: true },
    },
    page: { url: 'https://shop.example.test/p/hat' },
    policies: nextPage,
  });
  assert.equal(nextPage.shipping.revision, nextJsonLd && 2);
  assert.equal(nextPage.returns.revision, 2);
  assert.equal(nextPage.shipping.revision, shipUpdate.policy.revision);
  assert.equal(nextPage.returns.revision, returnUpdate.policy.revision);
  assert.equal(nextJsonLd.offers.shippingDetails.shippingRate.value, '0.00');
  assert.equal(nextJsonLd.offers.hasMerchantReturnPolicy.merchantReturnDays, 30);
  assert.deepEqual(
    nextPage.shipping.shippingDestinationCountries,
    nextJsonLd.offers.shippingDetails.shippingDestination.map((d) => d.addressCountry),
  );
});

test('return policy refuses empty configuration rather than inventing defaults', async () => {
  const returns = memory();
  await assert.rejects(() => setStoreReturnPolicy(returns, {}), /at least one configured field/);
  assert.equal(await returns.get('active'), null);
});
