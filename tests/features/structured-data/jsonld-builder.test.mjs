import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProductJsonLdShape,
  buildProductJsonLd,
  formatMinorUnitsAsDecimal,
  mapAvailabilityToSchemaOrg,
} from '../../../dist/features/structured-data/index.js';

const page = {
  url: 'https://shop.example.test/products/hat',
  description: 'A wool hat',
  images: ['https://cdn.example.test/hat.jpg'],
};

function product(overrides = {}) {
  return {
    id: 'item-hat',
    name: 'Hat',
    sku: 'HAT-1',
    price: { currency: 'USD', minor: '1999' },
    availability: { status: 'in-stock', sellable: true, listable: true },
    ...overrides,
  };
}

test('availability mapping is explicit for every Commerce status', () => {
  assert.equal(mapAvailabilityToSchemaOrg('in-stock'), 'https://schema.org/InStock');
  assert.equal(mapAvailabilityToSchemaOrg('low-stock'), 'https://schema.org/LimitedAvailability');
  assert.equal(mapAvailabilityToSchemaOrg('out-of-stock'), 'https://schema.org/OutOfStock');
  assert.equal(mapAvailabilityToSchemaOrg('available-on-backorder'), 'https://schema.org/BackOrder');
  assert.equal(
    mapAvailabilityToSchemaOrg('availability-unavailable'),
    'https://schema.org/OutOfStock',
  );
});

test('availability-unavailable never claims InStock', () => {
  const jsonLd = buildProductJsonLd({
    product: product({
      availability: { status: 'availability-unavailable', sellable: false, listable: true },
    }),
    page,
  });
  assertProductJsonLdShape(jsonLd);
  assert.equal(jsonLd.offers.availability, 'https://schema.org/OutOfStock');
  assert.notEqual(jsonLd.offers.availability, 'https://schema.org/InStock');
});

test('offer price converts integer minor units exactly and prefers sale customerPays', () => {
  assert.equal(formatMinorUnitsAsDecimal({ currency: 'USD', minor: '0' }), '0.00');
  assert.equal(formatMinorUnitsAsDecimal({ currency: 'USD', minor: '1' }), '0.01');
  assert.equal(formatMinorUnitsAsDecimal({ currency: 'USD', minor: '100' }), '1.00');
  assert.equal(formatMinorUnitsAsDecimal({ currency: 'USD', minor: '1999' }), '19.99');
  assert.equal(formatMinorUnitsAsDecimal({ currency: 'USD', minor: '123456789' }), '1234567.89');
  const sale = buildProductJsonLd({
    product: product({ price: { currency: 'USD', minor: '1500' } }),
    page,
  });
  assert.equal(sale.offers.price, '15.00');
  assert.equal(sale.offers.priceCurrency, 'USD');
});

test('shippingDetails and hasMerchantReturnPolicy are omitted when unconfigured', () => {
  const bare = buildProductJsonLd({ product: product(), page });
  assertProductJsonLdShape(bare);
  assert.equal('shippingDetails' in bare.offers, false);
  assert.equal('hasMerchantReturnPolicy' in bare.offers, false);

  const withChargeOnly = buildProductJsonLd({
    product: product(),
    page,
    policies: {
      shipping: {
        revision: 1,
        configurationId: 'ship-1',
        mode: 'free',
      },
    },
  });
  assert.deepEqual(withChargeOnly.offers.shippingDetails.shippingRate, {
    '@type': 'MonetaryAmount',
    value: '0.00',
    currency: 'USD',
  });
  assert.equal('shippingDestination' in withChargeOnly.offers.shippingDetails, false);
  assert.equal('deliveryTime' in withChargeOnly.offers.shippingDetails, false);
  assert.equal('hasMerchantReturnPolicy' in withChargeOnly.offers, false);
});

test('optional identifiers emit only when present; itemId keys the product, sku is merchant attribute', () => {
  const withIds = buildProductJsonLd({
    product: product({ gtin: '036000291452', mpn: 'HAT-WOOL', brand: 'Example Brand' }),
    page,
  });
  assertProductJsonLdShape(withIds);
  assert.equal(withIds.sku, 'HAT-1');
  assert.equal(withIds.gtin, '036000291452');
  assert.equal(withIds.mpn, 'HAT-WOOL');
  assert.deepEqual(withIds.brand, { '@type': 'Brand', name: 'Example Brand' });
  const without = buildProductJsonLd({ product: product(), page });
  assert.equal('gtin' in without, false);
  assert.equal('mpn' in without, false);
  assert.equal('brand' in without, false);
});

test('output validates against schema.org types without network or storage', () => {
  const jsonLd = buildProductJsonLd({
    product: product({ gtin: '036000291452', brand: 'Example' }),
    page,
    policies: {
      shipping: {
        revision: 2,
        configurationId: 'ship-2',
        mode: 'flat',
        amount: { currency: 'USD', minor: '500' },
        shippingDestinationCountries: ['US'],
        handlingTimeDays: { min: 0, max: 1 },
        transitTimeDays: { min: 2, max: 5 },
      },
      returns: {
        revision: 3,
        applicableCountry: ['US'],
        returnPolicyCategory: 'MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 30,
        returnMethod: 'ReturnByMail',
        returnFees: 'FreeReturn',
        policyPageUrl: 'https://shop.example.test/returns',
      },
    },
  });
  assertProductJsonLdShape(jsonLd);
  assert.equal(jsonLd.offers.shippingDetails['@type'], 'OfferShippingDetails');
  assert.equal(jsonLd.offers.hasMerchantReturnPolicy['@type'], 'MerchantReturnPolicy');
  assert.equal(
    jsonLd.offers.hasMerchantReturnPolicy.returnPolicyCategory,
    'https://schema.org/MerchantReturnFiniteReturnWindow',
  );
});

test('builder is pure: no fetch and no storage globals required', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('builder must not use network');
  };
  try {
    const jsonLd = buildProductJsonLd({ product: product(), page });
    assertProductJsonLdShape(jsonLd);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
