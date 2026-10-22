import { withEmDashRuntime } from 'emdash/middleware';
import { createSettingsAccess, OptionsRepository } from 'emdash';
import { siteId, bindingRef, origin, payFixture, publicReceipt } from '../../../transport.mjs';
let seeded = false;
export async function POST({ request }) {
  if (!import.meta.env.DEV) return new Response(null, { status: 403 });
  if (new URL(request.url).hostname !== '127.0.0.1') return new Response(null, { status: 403 });
  const action = new URL(request.url).searchParams.get('action');
  if (action === 'pay') { payFixture(); return Response.json(publicReceipt()); }
  // Deliver through EmDash's public hook pipeline, exactly as its cron executor does.
  // This proves wake handling, not timer/platform scheduling. No direct product calls or DB repair.
  if (action === 'wake') return withEmDashRuntime(async runtime => {
    const delivery = await runtime.hooks.invokeCronHook('dinkus-commerce', { name: 'commerce-checkout-wakes', scheduledAt: new Date().toISOString() });
    if (!delivery.success) return new Response(null, { status: 503 });
    return Response.json(publicReceipt());
  });
  if (action !== 'bootstrap' || seeded) return new Response(null, { status: 409 });
  return withEmDashRuntime(async runtime => {
    await runtime.syncPluginStorageIndexesOnce();
    const schema = { installedCheckout: { type: 'string', label: 'Checkout' }, connection: { type: 'secret', label: 'DinkusKit connection' } };
    const settings = createSettingsAccess(new OptionsRepository(runtime.db), 'dinkus-commerce', schema);
    await settings.set('installedCheckout', JSON.stringify({ schema: 'dinkuskit.commerce.registry-checkout/v1', enabled: true,
      commerceOrigin: origin, siteId, paymentsOrigin: 'https://payments.dinkuskit.com', bindingRef,
      providerId: 'stripe', mode: 'test', stripeAccountId: 'acct_localfixture',
      pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1', issuer: 'https://dinkuskit.com/account', audience: 'local-payments',
      shipping: { configurationId: 'local-free-shipping', revision: 1, mode: 'free' } }));
    await settings.set('connection', JSON.stringify({ siteId, storeKey: 'dk_store_' + 's'.repeat(43) }));
    seeded = true;
    return Response.json({ seeded: true, sandboxAvailable: runtime.getSandboxRunner()?.isAvailable() });
  });
}
export function GET() { return Response.json(publicReceipt()); }
