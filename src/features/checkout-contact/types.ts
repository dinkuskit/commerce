import type { PluginContext } from "emdash";

export const CHECKOUT_CONTACT_SNAPSHOT_SCHEMA =
  "dinkuskit.commerce.checkout-contact/v1" as const;

export interface CheckoutContactRequirements {
  readonly requirePhoneNumber: boolean;
  /** Countries the store ships physical items to (store settings). */
  readonly shippingCountries: readonly string[];
  readonly revision: string | null;
}

export type CheckoutContactRequirementsLoader = () => Promise<CheckoutContactRequirements>;

/** Where a physical order goes, as the shopper typed it at checkout. A billing address has the same shape. */
export interface CheckoutDeliveryAddress {
  readonly name: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode: string;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
}

export interface NormalizedCheckoutContact {
  readonly email: string;
  readonly phone?: string;
  /** Present only when the basket holds a physical item. */
  readonly delivery?: CheckoutDeliveryAddress;
  /** A full copy, never a reference to the delivery address. Absent only on checkouts frozen before billing was recorded. */
  readonly billing?: CheckoutDeliveryAddress;
}

export interface CheckoutContactSnapshot {
  readonly schema: typeof CHECKOUT_CONTACT_SNAPSHOT_SCHEMA;
  readonly contact: NormalizedCheckoutContact;
  readonly requirePhoneNumber: boolean;
  readonly revision: string | null;
}

export type CheckoutContactSettings = Pick<PluginContext["settings"], "getVersioned">;
