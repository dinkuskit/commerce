import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GUEST_CHECKOUT_PREPARE_ROUTE, GUEST_CHECKOUT_START_ROUTE } from "../../dist/index.js";
import {
  initializeGuestCheckoutDatabase,
  injectedPluginRoutes,
  invokeGuest,
  openGuestCollections,
  prepareGuest,
  seedGuestCatalog,
  syntheticCheckoutHost,
} from "../features/checkout/guest-dispatch.mjs";

test("native PluginStorageRepository dispatch retains one paid order across connection reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guest-dispatch-"));
  const path = join(dir, "commerce.sqlite");
  const connections = [];
  try {
    initializeGuestCheckoutDatabase(path);
    const left = openGuestCollections(path);
    connections.push(left);
    await seedGuestCatalog(left.storage);
    const synth = syntheticCheckoutHost();
    const plugin = injectedPluginRoutes(synth.host);
    const prepared = await prepareGuest(plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], left.storage);
    const token = prepared.capability.capability;
    const started = await invokeGuest(
      plugin.routes[GUEST_CHECKOUT_START_ROUTE],
      left.storage,
      { lines: [{ catalogItemId: "hat", quantity: 1 }] },
      { capability: token },
    );
    assert.equal(typeof started.checkout.attemptId, "string");
    synth.setPayment("paid");
    const paid = await invokeGuest(
      plugin.routes["checkout/guest/status"],
      left.storage,
      { wake: true },
      { capability: token },
    );
    assert.equal(paid.checkout.state, "paid");
    await left.db.destroy();
    connections.splice(0, 1);
    const reopened = openGuestCollections(path);
    connections.push(reopened);
    const recovered = await invokeGuest(
      plugin.routes["checkout/guest/status"],
      reopened.storage,
      { wake: true, paid: false },
      { capability: token },
    );
    assert.deepEqual(recovered.checkout.order, paid.checkout.order);
    assert.equal(recovered.checkout.order.paymentId, undefined);
  } finally {
    for (const connection of connections) await connection.db.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});
