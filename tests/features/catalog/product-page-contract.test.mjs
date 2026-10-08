import assert from "node:assert/strict";
import test from "node:test";

// Minimal host-side contract fixture. Commerce never owns this state; the
// fixture makes the required atomic publication behavior executable.
class HostProductPages {
  #published = new Map();
  #queue = Promise.resolve();

  publish(itemId, pageId) {
    const operation = this.#queue.then(() => {
      if (this.#published.has(itemId)) return { accepted: false, pageId: null };
      this.#published.set(itemId, pageId);
      return { accepted: true, pageId };
    });
    this.#queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  unpublish(itemId, pageId) {
    const operation = this.#queue.then(() => {
      if (this.#published.get(itemId) !== pageId) return false;
      this.#published.delete(itemId);
      return true;
    });
    this.#queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  resolve(itemId) {
    return Promise.resolve(this.#published.get(itemId) ?? null);
  }
}

test("host canonical-page contract serializes simultaneous duplicate publishes", async () => {
  const pages = new HostProductPages();
  const outcomes = await Promise.all([
    pages.publish("item-1", "page-a"),
    pages.publish("item-1", "page-b"),
  ]);

  assert.deepEqual(outcomes, [
    { accepted: true, pageId: "page-a" },
    { accepted: false, pageId: null },
  ]);
  assert.equal(await pages.resolve("item-1"), "page-a");
});

test("host canonical-page contract handles sequential duplicates, unpublish, and republish", async () => {
  const pages = new HostProductPages();
  assert.deepEqual(await pages.publish("item-2", "page-a"), {
    accepted: true,
    pageId: "page-a",
  });
  assert.deepEqual(await pages.publish("item-2", "page-b"), {
    accepted: false,
    pageId: null,
  });
  assert.equal(await pages.unpublish("item-2", "page-a"), true);
  assert.equal(await pages.resolve("item-2"), null);
  assert.deepEqual(await pages.publish("item-2", "page-b"), {
    accepted: true,
    pageId: "page-b",
  });
  assert.equal(await pages.resolve("item-2"), "page-b");
});
