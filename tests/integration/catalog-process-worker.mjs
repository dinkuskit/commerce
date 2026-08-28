import { createCatalogItem } from "../../dist/index.js";
import { openCatalogRepository } from "./sqlite-fixture.mjs";

const [databasePath, commandId, name, sku] = process.argv.slice(2);
const { db, storage } = openCatalogRepository(databasePath);

process.send?.({ type: "ready" });
process.on("message", async (message) => {
  if (message !== "go") return;
  try {
    const result = await createCatalogItem(storage, { commandId, name, sku });
    process.send?.({ type: "result", ok: true, result });
  } catch (error) {
    process.send?.({
      type: "result",
      ok: false,
      code: typeof error === "object" && error && "code" in error ? error.code : "UNKNOWN",
    });
  } finally {
    await db.destroy();
    process.disconnect?.();
  }
});
