import type { StockManagement } from "./types.js";

export function createInitialStockManagement(manageStock: boolean): StockManagement {
  return manageStock
    ? { mode: "managed", status: "setup-required" }
    : { mode: "unmanaged" };
}

export function setManageStock(
  current: StockManagement,
  manageStock: boolean,
): StockManagement {
  if (!manageStock) return { mode: "unmanaged" };
  if (current.mode === "managed") return current;
  return { mode: "managed", status: "setup-required" };
}
