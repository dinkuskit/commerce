import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { catalogApi, CATALOG_API_ROUTE } from '../../../dist/admin/index.js';
import { readPublicCatalogItem } from '../../../dist/features/catalog/index.js';
import { shop } from './catalog-store.mjs';

// catalog-api-20261027: agents and the CLI manage products with the panels' own checks, as JSON.
test('an agent makes a Draft product for a page, prices it, adds a choice and reads it back', async () => {
  const { ctx, call } = shop();
  assert.equal(CATALOG_API_ROUTE, 'catalog');
  const { catalogItemId } = await call({ op: 'create', commandId: 'gfb-runtz', name: 'Runtz', sku: 'RUNTZ', entryId: 'page-runtz' });
  const made = await ctx.storage.catalog_items.get(catalogItemId);
  assert.deepEqual([made.name, made.sku, made.fulfillment, made.offSale], ['Runtz', 'RUNTZ', 'physical', true], 'a physical Draft, off the shop');
  assert.deepEqual(await ctx.storage.product_pages.get('e:page-runtz'), { entryId: 'page-runtz', catalogItemId }, 'linked to its page (#194)');
  assert.deepEqual(await call({ op: 'create', commandId: 'gfb-runtz', name: 'Runtz', sku: 'RUNTZ' }), { catalogItemId }, 'a retry finds the same product');
  const unmanaged = await call({ op: 'create', commandId: 'gfb-managed', name: 'Managed', sku: 'MANAGED', manageStock: true, fulfillment: 'digital' });
  assert.deepEqual([(await ctx.storage.catalog_items.get(unmanaged.catalogItemId)).stockManagement.mode, (await ctx.storage.catalog_items.get(unmanaged.catalogItemId)).fulfillment], ['unmanaged', 'physical'], 'only the panel\'s fields are taken');

  const saved = await call({ op: 'prices', catalogItemId, regular: '12.00', sale: '', stockStatus: 'in-stock' });
  assert.equal(saved.saved, true);
  assert.equal(saved.regular, '12.00');
  const refused = await call({ op: 'prices', catalogItemId, regular: '5.00', sale: '6.00' });
  assert.equal(refused.saved, false, 'a refused save says why instead of writing');
  await assert.rejects(call({ op: 'prices', catalogItemId, regular: '5.00', sale: '', manageStock: true }), error => error.code === 'MANAGE_STOCK_UNAVAILABLE');

  const choice = await call({ op: 'choice', productId: catalogItemId, optionId: 'size', optionLabel: 'Size', values: [
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
});

test('SKU, weight, identifiers, pictures, feeds, archive and link go through the panels\' checks', async () => {
  const { ctx, call } = shop();
  const { catalogItemId } = await call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG' });
  assert.deepEqual(await call({ op: 'weight', catalogItemId, weightOz: '12.5' }), { changed: true });
  assert.equal((await ctx.storage.catalog_items.get(catalogItemId)).weightOz, 12.5);
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
  assert.deepEqual(await call({ op: 'create', commandId: 'mug', name: 'Mug', sku: 'MUG' }), { catalogItemId }, 'a create retry still finds the renamed product');
  const cup = await call({ op: 'create', commandId: 'cup', name: 'Cup', sku: 'CUP' });
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
  assert.deepEqual((await ctx.storage.product_feed_eligibility.get(catalogItemId)).channels, ['google-merchant']);

  assert.deepEqual(await call({ op: 'link', entryId: 'page-mug', catalogItemId }), { linked: true });
  assert.deepEqual(await call({ op: 'archive', catalogItemId, archived: true }), { changed: true });
  assert.equal(await readPublicCatalogItem(ctx, catalogItemId), null);
  assert.deepEqual(await call({ op: 'archive', catalogItemId, archived: false }), { changed: true });
  assert.equal((await ctx.storage.catalog_items.get(catalogItemId)).offSale, true, 'restored as a Draft');
  for (const input of [{}, { op: 'delete', catalogItemId }, null, 'list']) {
    await assert.rejects(catalogApi({ input }, ctx), /Invalid catalog request/);
  }
});

test('a write carrying a preview code is saved only while the product still reads the same', async () => {
  const { ctx, call } = shop();
  const { catalogItemId } = await call({ op: 'create', commandId: 'hat', name: 'Hat', sku: 'HAT' });
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
  // Feed channels are stored apart from the product, and a preview covers them too.
  const feeds = await code();
  await call({ op: 'feeds', catalogItemId, channels: ['google-merchant'] });
  assert.deepEqual((await call({ op: 'get', catalogItemId })).feeds, ['google-merchant']);
  await assert.rejects(call({ op: 'feeds', catalogItemId, channels: [], expected: feeds }), error => error.code === 'COMMAND_CONFLICT');
  assert.deepEqual((await ctx.storage.product_feed_eligibility.get(catalogItemId)).channels, ['google-merchant'], 'the newer channels stay');
  const choice = await code();
  assert.equal((await call({ op: 'choice', productId: catalogItemId, optionId: 'size', optionLabel: 'Size', expected: choice, values: [
    { valueId: 's', label: 'S', member: { catalogItemId, fulfillment: 'physical' } },
    { valueId: 'l', label: 'L', member: { commandId: 'hat-l', name: 'Hat', sku: 'HAT-L', fulfillment: 'physical' } },
  ] })).changed, true, 'a choice is checked against its product');
});

