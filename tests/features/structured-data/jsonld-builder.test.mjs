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

test('the Offer carries no shipping or return terms: a store\'s policies are its EmDash pages', () => {
  const bare = buildProductJsonLd({ product: product(), page });
  assertProductJsonLdShape(bare);
  assert.equal('shippingDetails' in bare.offers, false);
  assert.equal('hasMerchantReturnPolicy' in bare.offers, false);
  // Policy input from an older host is ignored, and the shape check refuses terms on an Offer.
  const legacy = buildProductJsonLd({ product: product(), page, policies: { shipping: { revision: 1, configurationId: 'ship-1', mode: 'free' } } });
  assert.deepEqual(legacy, bare);
  assert.throws(
    () => assertProductJsonLdShape({ ...bare, offers: { ...bare.offers, shippingDetails: { '@type': 'OfferShippingDetails' } } }),
    /must not carry shipping or return terms/,
  );
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
  });
  assertProductJsonLdShape(jsonLd);
  assert.equal(jsonLd.offers['@type'], 'Offer');
  assert.deepEqual(jsonLd.brand, { '@type': 'Brand', name: 'Example' });
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
