import { setupI18n, type Messages } from '@lingui/core';
import type { SandboxedRouteContext } from 'emdash/plugin';
import { englishCouponCatalog } from './coupon-catalog.js';

export function couponText(route: SandboxedRouteContext) {
  const locale = route.ui?.locale || 'en';
  // The plugin currently ships an English source catalog. The host controls
  // locale and document direction; unsupported translations use English.
  const messages = englishCouponCatalog as unknown as Messages;
  const i18n = setupI18n({ locale, messages: { [locale]: messages } });
  return (message: string, values?: Record<string, unknown>) =>
    i18n._(message, values, { message });
}
