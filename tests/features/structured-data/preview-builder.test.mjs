import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductPreviewJsonLd } from '@dinkuskit/commerce/features/structured-data';

const page = {
  url: 'https://shop.example.test/products/preview-hat',
  name: ' Preview hat ',
};

test('preview emits only provided page facts, even if extra Commerce facts reach JavaScript', () => {
  const jsonLd = buildProductPreviewJsonLd({
    ...page,
    description: 'A forthcoming wool hat',
    images: ['https://cdn.example.test/preview-hat.jpg'],
    id: 'not-a-preview-identity',
    sku: 'NOT-A-SKU',
    gtin: '036000291452',
    mpn: 'NOT-A-MPN',
    brand: 'Not a preview brand',
    price: { currency: 'USD', minor: '1999' },
    availability: { status: 'in-stock', sellable: true, listable: true },
    offers: { '@type': 'Offer' },
  });

  assert.deepEqual(jsonLd, {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Preview hat',
    url: page.url,
    description: 'A forthcoming wool hat',
    image: 'https://cdn.example.test/preview-hat.jpg',
  });
});

test('preview omits absent or empty optional page facts', () => {
  const expected = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Preview hat',
    url: page.url,
  };
  assert.deepEqual(buildProductPreviewJsonLd(page), expected);
  assert.deepEqual(buildProductPreviewJsonLd({ ...page, description: '', images: [] }), expected);
});

test('preview preserves multiple images without retaining the input array', () => {
  const images = ['https://cdn.example.test/front.jpg', 'https://cdn.example.test/back.jpg'];
  const jsonLd = buildProductPreviewJsonLd({ ...page, images });
  assert.deepEqual(jsonLd.image, images);
  assert.notEqual(jsonLd.image, images);
  images.push('https://cdn.example.test/later.jpg');
  assert.equal(jsonLd.image.length, 2);
});

test('preview rejects missing, non-string, or blank canonical URL and display name', () => {
  for (const url of [undefined, null, 123, '', '  ']) {
    assert.throws(() => buildProductPreviewJsonLd({ ...page, url }), /canonical URL.*required/);
  }
  for (const name of [undefined, null, 123, '', '  ']) {
    assert.throws(() => buildProductPreviewJsonLd({ ...page, name }), /display name.*required/);
  }
  assert.throws(() => buildProductPreviewJsonLd(), /canonical URL.*required/);
});
