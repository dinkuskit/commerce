import {
  createManagedSkuRegistrationClaimKey,
  createManagedSkuRegistrationClaimPort,
} from "../../dist/index.js";
import { openClaimRepository } from "./sqlite-fixture.mjs";

const [databasePath, operationId, poolId] = process.argv.slice(2);
const { db, storage } = openClaimRepository(databasePath);
const port = createManagedSkuRegistrationClaimPort(storage, {
  createRecordId: () => `record:${operationId}`,
  now: () => new Date("2026-08-29T00:00:00.000Z"),
});

process.send?.({ type: "ready" });
process.on("message", async (message) => {
  if (message !== "go") return;
  try {
    const result = await port.claim({
      claimKey: createManagedSkuRegistrationClaimKey({ catalogItemId: "product-1" }),
      catalogItemId: "product-1",
      registration: {
        operationId,
        request: {
          poolId,
          sku: "GRILL-1",
          displayNameIfNew: "Grill One",
        },
      },
    });
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
