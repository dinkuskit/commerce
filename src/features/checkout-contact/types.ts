import type { PluginContext } from "emdash";

export const CHECKOUT_CONTACT_SNAPSHOT_SCHEMA =
  "dinkuskit.commerce.checkout-contact/v1" as const;

export interface CheckoutContactRequirements {
  readonly requirePhoneNumber: boolean;
  readonly revision: string | null;
}

export type CheckoutContactRequirementsLoader = () => Promise<CheckoutContactRequirements>;

export interface NormalizedCheckoutContact {
  readonly email: string;
  readonly phone?: string;
}

export interface CheckoutContactSnapshot {
  readonly schema: typeof CHECKOUT_CONTACT_SNAPSHOT_SCHEMA;
  readonly contact: NormalizedCheckoutContact;
  readonly requirePhoneNumber: boolean;
  readonly revision: string | null;
}

export type CheckoutContactSettings = Pick<PluginContext["settings"], "getVersioned">;
