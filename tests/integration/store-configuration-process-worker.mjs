import { createStoreInventoryConfiguration } from "../../dist/index.js";
import { openStoreInventoryConfigurationRepository } from "./sqlite-fixture.mjs";

const [databasePath, contender] = process.argv.slice(2);
const { db, storage } = openStoreInventoryConfigurationRepository(databasePath);

process.send?.({ type: "ready" });
process.on("message", async (message) => {
  if (message !== "go") return;
  try {
    const result = await createStoreInventoryConfiguration(
      storage,
      {
        providerRef: "dinkuskit.inventory",
        poolId: "pool-smoky",
        defaultFulfillmentLocationId: "murphy-nc",
      },
      {
        createRecordId: () => `configuration-${contender}`,
        createSiteId: () => `site-${contender}`,
        now: () => new Date("2026-08-30T00:00:00.000Z"),
      },
    );
    process.send?.({ type: "result", ok: true, result });
  } catch (error) {
    process.send?.({
      type: "result",
      ok: false,
      code: typeof error === "object" && error && "code" in error ? error.code : "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await db.destroy();
    process.disconnect?.();
  }
});
