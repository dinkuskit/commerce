import type { StorageCollection } from "emdash";
import type { CheckoutDeliveryAddress } from "../checkout-contact/index.js";
import type { ShopperOrderSummary } from "../orders/index.js";

export const SHOPPER_ACCOUNTS_FEATURE_ID = "dinkus.customers";

export const CUSTOMERS_COLLECTION = "customers";
export const CUSTOMER_LOGIN_CODES_COLLECTION = "customer_login_codes";
export const CUSTOMER_SESSIONS_COLLECTION = "customer_sessions";

export const NATIVE_CUSTOMERS_COLLECTION = "customers";
export const NATIVE_CUSTOMER_LOGIN_CODES_COLLECTION = "customerLoginCodes";
export const NATIVE_CUSTOMER_SESSIONS_COLLECTION = "customerSessions";

export const CUSTOMER_SESSION_HEADER = "x-commerce-customer-session";
export const CUSTOMER_ORIGIN_HEADER = "origin";
export const CUSTOMER_SEC_FETCH_SITE_HEADER = "sec-fetch-site";

export const SHOPPER_ACCOUNT_WRITE_HEADERS = [
  CUSTOMER_ORIGIN_HEADER,
  CUSTOMER_SEC_FETCH_SITE_HEADER,
] as const;

export const SHOPPER_ACCOUNT_SESSION_HEADERS = [
  CUSTOMER_SESSION_HEADER,
  CUSTOMER_ORIGIN_HEADER,
  CUSTOMER_SEC_FETCH_SITE_HEADER,
] as const;

export const SHOPPER_SIGN_IN_START_ROUTE = "account/sign-in/start";
export const SHOPPER_SIGN_IN_VERIFY_ROUTE = "account/sign-in/verify";
export const SHOPPER_SIGN_OUT_ROUTE = "account/sign-out";
export const SHOPPER_ACCOUNT_ORDERS_ROUTE = "account/orders";
export const SHOPPER_ACCOUNT_PROFILE_ROUTE = "account/profile";

export const LOGIN_CODE_TTL_SECONDS = 600;
export const LOGIN_CODE_COOLDOWN_SECONDS = 30;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const CUSTOMER_SESSION_TTL_SECONDS = 30 * 86400;

export type ShopperAccountErrorCode =
  | "CODE_EXPIRED"
  | "CODE_INVALID"
  | "CONTENTION"
  | "DELIVERY_COUNTRY_UNAVAILABLE"
  | "DELIVERY_INVALID"
  | "EMAIL_INVALID"
  | "EMAIL_REQUIRED"
  | "EMAIL_UNAVAILABLE"
  | "INVALID_INPUT"
  | "ORIGIN_DENIED"
  | "PHONE_REQUIRED"
  | "RATE_LIMITED"
  | "SESSION_DENIED"
  | "UNAVAILABLE";

export interface CustomerRecord {
  recordKind: "commerce-customer";
  emailKey: string;
  email: string;
  phone?: string;
  delivery?: CheckoutDeliveryAddress;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerLoginCodeRecord {
  recordKind: "commerce-customer-login-code";
  emailKey: string;
  verifier: string;
  attempts: number;
  issuedAt: number;
  expiresAt: number;
}

export interface CustomerSessionRecord {
  recordKind: "commerce-customer-session";
  sessionId: string;
  emailKey: string;
  verifier: string;
  siteBinding: string;
  createdAt: number;
  expiresAt: number;
}

export interface CustomerSessionPresentation {
  sessionId: string;
  session: string;
  retention: "json-body";
  header: typeof CUSTOMER_SESSION_HEADER;
  expiresAt: string;
}

export interface ShopperProfileProjection {
  email: string;
  phone: string | null;
  delivery: CheckoutDeliveryAddress | null;
}

export interface ShopperEmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface ShopperEmailSender {
  send(message: ShopperEmailMessage): Promise<void>;
}

export type CustomersStorage = Pick<
  StorageCollection<CustomerRecord>,
  "get" | "getVersioned" | "compareAndSet"
>;

export type CustomerLoginCodesStorage = Pick<
  StorageCollection<CustomerLoginCodeRecord>,
  "get" | "getVersioned" | "compareAndSet" | "delete"
>;

export type CustomerSessionsStorage = Pick<
  StorageCollection<CustomerSessionRecord>,
  "get" | "getVersioned" | "compareAndSet" | "delete"
>;

export interface ShopperAccountHostOptions {
  siteUrl?: string;
  topLevelSiteUrl?: string;
  storeName?: string;
  now?: () => number;
  createSessionId?: () => string;
  createSessionSecret?: () => string;
  createLoginCode?: () => string;
  sendEmail?: (message: ShopperEmailMessage) => Promise<void>;
  loadOrdersForEmail?: (emailKey: string) => Promise<ShopperOrderSummary[]>;
  loadShippingCountries?: () => Promise<{ requirePhoneNumber: boolean; shippingCountries: readonly string[] }>;
}

export interface ShopperAccountRuntime {
  customers: CustomersStorage;
  loginCodes: CustomerLoginCodesStorage;
  sessions: CustomerSessionsStorage;
  runtimeSiteUrl?: string;
  constructorSiteUrl?: string;
  topLevelSiteUrl?: string;
  host: ShopperAccountHostOptions;
}

export type ShopperSignInStartResult =
  | {
      ok: true;
      email: string;
      expiresAt: string;
    }
  | {
      ok: false;
      error: { code: ShopperAccountErrorCode; message: string };
    };

export type ShopperSignInVerifyResult =
  | {
      ok: true;
      capability: CustomerSessionPresentation;
      profile: ShopperProfileProjection;
    }
  | {
      ok: false;
      error: { code: ShopperAccountErrorCode; message: string };
    };

export type ShopperSignOutResult =
  | {
      ok: true;
      signedOut: true;
    }
  | {
      ok: false;
      error: { code: ShopperAccountErrorCode; message: string };
    };

export type ShopperAccountOrdersResult =
  | {
      ok: true;
      profile: ShopperProfileProjection;
      orders: ShopperOrderSummary[];
    }
  | {
      ok: false;
      error: { code: ShopperAccountErrorCode; message: string };
    };

export type ShopperAccountProfileResult =
  | {
      ok: true;
      profile: ShopperProfileProjection;
    }
  | {
      ok: false;
      error: { code: ShopperAccountErrorCode; message: string };
    };
