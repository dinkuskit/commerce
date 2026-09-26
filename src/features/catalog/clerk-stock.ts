export const CLERK_STOCK_STATUSES = [
  "in-stock",
  "out-of-stock",
  "on-backorder",
] as const;

export type ClerkStockStatus = (typeof CLERK_STOCK_STATUSES)[number];

export const CLERK_STOCK_STATUS_MESSAGE =
  "Choose In stock, Out of stock, or On backorder.";
export const MANAGED_STOCK_STATUS_MESSAGE =
  "Stock status is hidden while Manage Stock is on.";
