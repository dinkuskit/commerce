import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryPackTransport, orderPackBody } from '../dist/admin/orders-pack.js';

test('Pack builds one ticket or every ticket, with a stable bounded command id and no order number', async () => {
 const one = await orderPackBody(['hat-ticket']);
 assert.deepEqual(Object.keys(one), ['commandId', 'type', 'reservationId']);
 assert.equal(one.type, 'stock.pack');
 assert.equal(one.reservationId, 'hat-ticket');
 assert.match(one.commandId, /^commerce\.pack:[0-9a-f]{64}$/);
 assert.deepEqual(await orderPackBody(['hat-ticket']), one);
 const every = await orderPackBody(['hat-ticket', 'shirt-ticket']);
 assert.deepEqual(Object.keys(every), ['commandId', 'type', 'reservationIds']);
 assert.equal(every.type, 'stock.pack_all');
 assert.deepEqual(every.reservationIds, ['hat-ticket', 'shirt-ticket']);
 assert.notEqual(every.commandId, one.commandId);
 assert.notEqual((await orderPackBody(['shirt-ticket', 'hat-ticket'])).commandId, every.commandId);
 assert.ok(every.commandId.length <= 200);
 assert.equal(JSON.stringify(every).includes('order'), false);
 for (const bad of [undefined, [], ['a', 'a'], [' a'], ['x'.repeat(201)], Array.from({ length: 101 }, (_, i) => 't' + i)]) {
  assert.equal(await orderPackBody(bad), null);
 }
});

function transport(respond) {
 const calls = [];
 const port = createInventoryPackTransport({
  inventoryOrigin: 'https://inventory.invalid',
  credential: async () => 'synthetic-account-token',
  fetch: async (url, init) => { calls.push({ url, init }); return respond(JSON.parse(init.body)); },
 });
 return { port, calls };
}

test('Inventory pack transport posts the exact body and reports packed only on a confirmed pack', async () => {
 const body = await orderPackBody(['hat-ticket']);
 const ok = transport(sent => Response.json({ outcome: 'packed', commandId: sent.commandId }));
 assert.equal(await ok.port.pack(body), 'packed');
 assert.equal(ok.calls[0].url, 'https://inventory.invalid/v1/stock/pack');
 assert.equal(ok.calls[0].init.method, 'POST');
 assert.equal(ok.calls[0].init.redirect, 'error');
 assert.equal(ok.calls[0].init.headers.authorization, 'Bearer synthetic-account-token');
 assert.deepEqual(JSON.parse(ok.calls[0].init.body), body);
 const all = await orderPackBody(['hat-ticket', 'shirt-ticket']);
 assert.equal(await transport(sent => Response.json({ outcome: 'packed_all', commandId: sent.commandId })).port.pack(all), 'packed');
});

test('Inventory pack transport fails closed on every other answer', async () => {
 const body = await orderPackBody(['hat-ticket']);
 const answers = [
  () => new Response('Not Found', { status: 404 }),
  () => Response.json({ error: 'inventory_not_ready' }, { status: 409 }),
  () => Response.json({ outcome: 'rejected', code: 'reservation_not_found' }, { status: 409 }),
  () => Response.json({ error: 'unauthorized' }, { status: 401 }),
  () => Response.json({ outcome: 'packed', commandId: 'someone-else' }),
  sent => Response.json({ outcome: 'packed_all', commandId: sent.commandId }),
  () => new Response('not json', { status: 200 }),
  () => { throw new TypeError('network down'); },
 ];
 for (const answer of answers) assert.equal(await transport(answer).port.pack(body), 'not_packed');
 const noCredential = createInventoryPackTransport({
  inventoryOrigin: 'https://inventory.invalid', credential: async () => { throw new Error('signed out'); },
  fetch: async () => { throw new Error('must not call'); },
 });
 assert.equal(await noCredential.pack(body), 'not_packed');
});
