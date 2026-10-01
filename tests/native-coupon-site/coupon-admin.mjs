import { CouponsPage, pages as nativePages } from "../../dist/admin/native.js";

// Test-only composition: production keeps CouponsPage named-only until core
// mounts the matching routes and storage.
export const pages = { ...nativePages, "/coupons": CouponsPage };
