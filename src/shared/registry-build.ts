/**
 * True only inside the Registry (sandbox) bundle. `scripts/build-sandbox.mjs`
 * swaps this module for `export const REGISTRY_BUILD = true;` so the bundler
 * drops code the Registry build cannot reach: Manage stock cannot be turned on
 * there (v1 admission refuses it), no Inventory provider is wired, so no
 * item is ever managed, no stock is ever reserved and no Pack button appears.
 * The native entry keeps the kernel paths; its local Manage stock test aid went
 * with the native-only routes (commerce-one-build-registry-20261031).
 */
export const REGISTRY_BUILD = false as boolean;
