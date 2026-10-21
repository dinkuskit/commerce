import {
  buildProductJsonLd,
  buildProductPreviewJsonLd,
  type BuildProductJsonLdInput,
  type BuildProductPreviewJsonLdInput,
  type ProductJsonLd,
  type ProductPreviewJsonLd,
} from '@dinkuskit/commerce/features/structured-data';

const page: BuildProductPreviewJsonLdInput = { url: 'https://shop.example.test/hat', name: 'Hat' };
const preview: ProductPreviewJsonLd = buildProductPreviewJsonLd(page);
// @ts-expect-error A preview cannot claim an Offer through its public output type.
preview.offers;
// @ts-expect-error A preview cannot claim a SKU through its public output type.
preview.sku;
// @ts-expect-error Display name is required for a preview.
buildProductPreviewJsonLd({ url: page.url });
// @ts-expect-error Canonical URL is required for a preview.
buildProductPreviewJsonLd({ name: page.name });
// @ts-expect-error Commerce identity is not an accepted preview input field.
buildProductPreviewJsonLd({ ...page, sku: 'SKU-1' });
// @ts-expect-error Existing Commerce Product output still requires a SKU.
const oldOutput: ProductJsonLd = preview;
declare const existingInput: BuildProductJsonLdInput;
const oldProduct: ProductJsonLd = buildProductJsonLd(existingInput);
const sku: string = oldProduct.sku;

import type { PublicCatalogProduct } from '@dinkuskit/commerce/features/catalog';
import type { ProductFeedChannel } from '@dinkuskit/commerce/features/feeds';
declare const publicProduct: PublicCatalogProduct;
const channels: readonly ProductFeedChannel[] = publicProduct.feedChannels ?? [];
// @ts-expect-error Public eligibility admits only the two approved channels.
const unsupported: NonNullable<PublicCatalogProduct['feedChannels']> = ['unapproved-channel'];
