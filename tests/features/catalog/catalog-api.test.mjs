import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { catalogApi, CATALOG_API_ROUTE } from '../../../dist/admin/index.js';
import { readPublicCatalogItem } from '../../../dist/features/catalog/index.js';
import { setProductPageOnSale } from '../../../dist/features/catalog/kernel/index.js';
import { shop } from './catalog-store.mjs';

// catalog-api-20261027: agents and the CLI manage products with the panels' own checks, as JSON.
test('an agent makes a Draft product for a page, prices it, adds an option and reads it back', async () => {
  const { ctx, call } = shop();
  assert.equal(CATALOG_API_ROUTE, 'catalog');
  const { catalogItemId } = await call({ op: 'create', commandId: 'gfb-runtz', name: 'Runtz', sku: 'RUNTZ', entryId: 'page-runtz' });
  const made = await ctx.storage.catalog_items.get(catalogItemId);
  assert.deepEqual([made.name, made.sku, made.fulfillment, made.offSale], ['Runtz', 'RUNTZ', 'physical', true], 'a physical Draft, off the shop');
  assert.deepEqual(await ctx.storage.product_pages.get('e:page-runtz'), { entryId: 'page-runtz', catalogItemId }, 'linked to its page (#194)');
  assert.equal((await call({ op: 'create', commandId: 'gfb-runtz', name: 'Runtz', sku: 'RUNTZ', entryId: 'page-runtz' })).catalogItemId, catalogItemId, 'a retry finds the same product');
  const unmanaged = await call({ op: 'create', commandId: 'gfb-managed', name: 'Managed', sku: 'MANAGED', manageStock: true, fulfillment: 'digital', entryId: 'page-managed' });
  assert.deepEqual([(await ctx.storage.catalog_items.get(unmanaged.catalogItemId)).stockManagement.mode, (await ctx.storage.catalog_items.get(unmanaged.catalogItemId)).fulfillment], ['unmanaged', 'digital'], 'Manage stock stays off; fulfillment is the panel\'s physical switch (catalog-first-save-creates-20261031)');

  const saved = await call({ op: 'prices', catalogItemId, regular: '12.00', sale: '', stockStatus: 'in-stock' });
  assert.equal(saved.saved, true);
  assert.equal(saved.regular, '12.00');
  const refused = await call({ op: 'prices', catalogItemId, regular: '5.00', sale: '6.00' });
  assert.equal(refused.saved, false, 'a refused save says why instead of writing');
  await assert.rejects(call({ op: 'prices', catalogItemId, regular: '5.00', sale: '', manageStock: true }), error => error.code === 'MANAGE_STOCK_UNAVAILABLE');

  const choice = await call({ op: 'option', productId: catalogItemId, optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId, fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'gfb-runtz-l', name: 'Runtz', sku: 'RUNTZ-L', fulfillment: 'physical' } },
  ] });
  assert.equal(choice.changed, true);
  assert.deepEqual(choice.product.options[0].values.map(value => value.label), ['Small', 'Large']);

  const listed = await call({ op: 'list' });
  assert.deepEqual(listed.products.map(product => product.sku).sort(), ['MANAGED', 'RUNTZ']);
  const got = await call({ op: 'get', catalogItemId });
  assert.equal(got.product.sku, 'RUNTZ');
  assert.equal(got.product.variantProduct.members.length, 2);
  assert.deepEqual([got.media.image, got.media.gallery], [null, []]);
  assert.equal((await call({ op: 'get', catalogItemId: 'missing' })).product, null);
  // catalog-page-link-in-commerce-20261029: Commerce holds the page's link, so an agent reads a page's product by its entry id.
  assert.deepEqual(await call({ op: 'get', entryId: 'page-runtz' }), got);
  assert.deepEqual(await call({ op: 'get', entryId: 'page-none' }), { product: null });
  assert.deepEqual(await call({ op: 'get' }), { product: null });
});

test('SKU, weight, identifiers, pictures, feeds and archive go through the panels\' checks', async () => {
  const { ctx, call } = shop();
  const { catalogItemId } = await call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG', entryId: 'page-mug' });
  assert.deepEqual(await call({ op: 'weight', catalogItemId, weightOz: '12.5' }), { changed: true });
  assert.equal((await ctx.storage.catalog_items.get(catalogItemId)).catalogData.items[catalogItemId].weightOz, 12.5);
  await assert.rejects(call({ op: 'weight', catalogItemId, weightOz: '0' }), error => error.code === 'INVALID_INPUT');

  assert.deepEqual(await call({ op: 'identifiers', catalogItemId, gtin: '4006381333931', brand: 'Funky' }), { changed: true });
  assert.deepEqual(await call({ op: 'identifiers', catalogItemId, mpn: 'M-1' }), { changed: true }, 'a left-out field stays');
  let record = await ctx.storage.catalog_items.get(catalogItemId);
  assert.deepEqual([record.gtin, record.mpn, record.brand], ['4006381333931', 'M-1', 'Funky']);
  await call({ op: 'identifiers', catalogItemId, brand: null });
  record = await ctx.storage.catalog_items.get(catalogItemId);
  assert.equal('brand' in record, false, 'null clears a field');
  await assert.rejects(call({ op: 'identifiers', catalogItemId, gtin: '4006381333932' }), error => error.code === 'INVALID_INPUT', 'GS1 check digit');
  await assert.rejects(call({ op: 'identifiers', catalogItemId, color: 'red' }), error => error.code === 'INVALID_INPUT');

  assert.deepEqual(await call({ op: 'sku', catalogItemId, sku: 'MUG-2' }), { changed: true });
  assert.equal((await ctx.storage.catalog_items.get(catalogItemId)).sku, 'MUG-2');
  assert.deepEqual(await call({ op: 'sku', catalogItemId, sku: 'MUG-2' }), { changed: false });
  assert.equal((await call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG', entryId: 'page-mug' })).catalogItemId, catalogItemId, 'a create retry still finds the renamed product');
  const cup = await call({ op: 'create', commandId: 'cup', name: 'Cup', sku: 'CUP', entryId: 'page-cup' });
  await assert.rejects(call({ op: 'sku', catalogItemId: cup.catalogItemId, sku: 'MUG-2' }), error => error.code === 'SKU_CONFLICT');
  await assert.rejects(call({ op: 'sku', catalogItemId, sku: '' }), error => error.code === 'INVALID_INPUT');
  // As setCatalogItemSku: no SKU change while the store cannot prove its SKU index is active.
  ctx.storage.catalog_items.unique = ['commandId'];
  await assert.rejects(call({ op: 'sku', catalogItemId: cup.catalogItemId, sku: 'MUG-2' }), error => error.code === 'STORAGE_CONSTRAINTS_UNAVAILABLE');
  assert.equal((await ctx.storage.catalog_items.get(cup.catalogItemId)).sku, 'CUP');
  ctx.storage.catalog_items.unique = ['commandId', 'skuKey'];

  const pictures = await call({ op: 'media', catalogItemId, image: '01HAT000000000000000000000', gallery: ['01SIDE00000000000000000000'] });
  assert.deepEqual([pictures.changed, pictures.media.image, pictures.media.gallery], [true, { mediaId: '01HAT000000000000000000000' }, [{ mediaId: '01SIDE00000000000000000000' }]]);
  await call({ op: 'feeds', catalogItemId, channels: ['google-merchant'] });
  assert.deepEqual((await ctx.storage.catalog_items.get(catalogItemId)).catalogData.feedChannels, ['google-merchant']);

  assert.deepEqual(await call({ op: 'archive', catalogItemId, archived: true }), { changed: true });
  assert.equal(await readPublicCatalogItem(ctx, catalogItemId), null);
  assert.deepEqual(await call({ op: 'archive', catalogItemId, archived: false }), { changed: true });
  assert.equal((await ctx.storage.catalog_items.get(catalogItemId)).offSale, true, 'restored as a Draft');
  for (const input of [{}, { op: 'delete', catalogItemId }, { op: 'link', entryId: 'page-other', catalogItemId }, { op: 'choice', productId: catalogItemId }, null, 'list']) {
    await assert.rejects(catalogApi({ input }, ctx), /Invalid catalog request/);
  }
});

test('every product is made for its page: create needs a page that sells no other product', async () => {
  // catalog-product-needs-page-20261031: no product without a page, as on Shopify and WooCommerce.
  const { ctx, call } = shop();
  const records = () => structuredClone(ctx.storage.catalog_items.records);
  await assert.rejects(call({ op: 'create', commandId: 'loose', name: 'Loose', sku: 'LOOSE' }), error => error.code === 'INVALID_INPUT' && /make the product's page first/.test(error.message));
  assert.equal(ctx.storage.catalog_items.records.size, 0, 'nothing is made without a page');
  const { catalogItemId } = await call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG', entryId: 'page-mug' });
  const before = records();
  // Another create for the same page is refused before anything is made; the same command again finds the same product.
  await assert.rejects(call({ op: 'create', commandId: 'cup', name: 'Cup', sku: 'CUP', entryId: 'page-mug' }), error => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.deepEqual(records(), before, 'no second product');
  assert.equal((await call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG', entryId: 'page-mug' })).catalogItemId, catalogItemId);
  assert.deepEqual(await ctx.storage.product_pages.get('e:page-mug'), { entryId: 'page-mug', catalogItemId });
  // A product another page already sells cannot be made for this page by replaying its command.
  await call({ op: 'prices', catalogItemId, regular: '12.00', sale: '', stockStatus: 'in-stock' });
  await setProductPageOnSale({ catalog: ctx.storage.catalog_items, pages: ctx.storage.product_pages }, { entryId: 'page-mug', onSale: true });
  await assert.rejects(call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG', entryId: 'page-other' }), error => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.equal(await ctx.storage.product_pages.get('e:page-other'), null);
  assert.equal((await readPublicCatalogItem(ctx, 'page-mug', true))?.id, catalogItemId);
  // A repeated command with changed input is refused, never answered with the product it made.
  await assert.rejects(call({ op: 'create', commandId: 'mug', name: 'Big mug', sku: 'MUG', entryId: 'page-mug' }), error => error.code === 'COMMAND_CONFLICT');
  await assert.rejects(call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG-2', entryId: 'page-mug' }), error => error.code === 'COMMAND_CONFLICT');
});

test('of two creates racing for one empty page, one sells it and the other is refused with its Draft archived', async () => {
  const { ctx, call } = shop();
  const a = { op: 'create', commandId: 'tee-a', name: 'Tee A', sku: 'TEE-A', entryId: 'page-tee' };
  const b = { op: 'create', commandId: 'tee-b', name: 'Tee B', sku: 'TEE-B', entryId: 'page-tee' };
  const results = await Promise.allSettled([call(a), call(b)]);
  const won = results.filter(result => result.status === 'fulfilled'), lost = results.filter(result => result.status === 'rejected');
  assert.deepEqual([won.length, lost.length, lost[0].reason.code], [1, 1, 'PRODUCT_PAGE_CONFLICT']);
  const winner = won[0].value.catalogItemId;
  assert.deepEqual(await ctx.storage.product_pages.get('e:page-tee'), { entryId: 'page-tee', catalogItemId: winner });
  const items = [...ctx.storage.catalog_items.records.values()];
  assert.equal(items.length, 2, 'both raced past the empty-page check');
  const loser = items.find(item => item.itemId !== winner);
  // The losing Draft is archived: off the shop, and out of the way of the page's product.
  assert.ok(loser.archivedAt && loser.offSale);
  // Retrying the losing command is refused the same way and makes nothing new.
  await assert.rejects(call(loser.commandId === 'tee-a' ? a : b), error => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.equal(ctx.storage.catalog_items.records.size, 2);
});

test('a write carrying a preview code is saved only while the product still reads the same', async () => {
  const { ctx, call } = shop();
  const { catalogItemId } = await call({ op: 'create', commandId: 'hat', name: 'Hat', sku: 'HAT', entryId: 'page-hat' });
  const code = async () => createHash('sha256').update(JSON.stringify(await call({ op: 'get', catalogItemId }))).digest('hex').slice(0, 12);
  const seen = await code();
  assert.equal((await call({ op: 'prices', catalogItemId, regular: '10.00', sale: '', expected: seen })).saved, true);
  // The product changed after that preview, so the same code no longer saves anything.
  await assert.rejects(call({ op: 'prices', catalogItemId, regular: '12.00', sale: '', expected: seen }),
    error => error.code === 'COMMAND_CONFLICT' && /The product changed since that preview/.test(error.message));
  await assert.rejects(call({ op: 'sku', catalogItemId, sku: 'HAT-2', expected: seen }), error => error.code === 'COMMAND_CONFLICT');
  const record = await ctx.storage.catalog_items.get(catalogItemId);
  assert.equal(record.sku, 'HAT');
  assert.equal((await call({ op: 'get', catalogItemId })).product.regular, '10.00');
  assert.deepEqual(await call({ op: 'sku', catalogItemId, sku: 'HAT-2', expected: await code() }), { changed: true });
  // Feed channels share the product save record, and a preview covers them too.
  const feeds = await code();
  await call({ op: 'feeds', catalogItemId, channels: ['google-merchant'] });
  assert.deepEqual((await call({ op: 'get', catalogItemId })).feeds, ['google-merchant']);
  await assert.rejects(call({ op: 'feeds', catalogItemId, channels: [], expected: feeds }), error => error.code === 'COMMAND_CONFLICT');
  assert.deepEqual((await ctx.storage.catalog_items.get(catalogItemId)).catalogData.feedChannels, ['google-merchant'], 'the newer channels stay');
  const choice = await code();
  assert.equal((await call({ op: 'option', productId: catalogItemId, optionId: 'size', optionLabel: 'Size', expected: choice, values: [
    { valueId: 's', label: 'S', member: { catalogItemId, fulfillment: 'physical' } },
    { valueId: 'l', label: 'L', member: { commandId: 'hat-l', name: 'Hat', sku: 'HAT-L', fulfillment: 'physical' } },
  ] })).changed, true, 'a choice is checked against its product');
});

