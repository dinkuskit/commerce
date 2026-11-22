import type { PluginContext, StorageCollection } from "emdash";
import { loadOutOfStockListing } from "../storefront-availability/kernel/index.js";
import { mintGuestCapability } from "./capability.js";
import { cartLines, stopKey } from "./guest.js";
import { canonicalizeHttpOrigin } from "./site-scope.js";
import type { CheckoutRecord } from "./types.js";

export const CART_EMAIL_STOPS = "cart_email_stops";

/**
 * The abandoned-cart email (commerce-abandoned-cart-email-20261122), from the background check 10 hours after
 * the shopper gave an email at checkout: at most one per cart, to a shopper who ticked "Email me
 * with news and offers" (or anyone, when the owner picks All customers), only while the checkout ended unpaid and
 * the cart still holds something. A checkout still open is looked at again an hour on.
 */
export async function remindCarts(ctx: PluginContext, now: number): Promise<void> {
  const carts = ctx.storage.checkout_carts as StorageCollection<CheckoutRecord>;
  const mode = (await loadOutOfStockListing(ctx.storage.storefront_out_of_stock_listing as never)).cartEmail;
  const origin = canonicalizeHttpOrigin(ctx.site.url);
  for (const { id } of (await carts.query({ where: { remindAt: { lt: String(now) } }, limit: 5 })).items) {
    const found = await carts.getVersioned(id);
    const record = found?.value;
    if (!found || !record?.remindAt || +record.remindAt > now) continue;
    const { remindAt: _, ...rest } = record;
    const attempt = record.attempts.at(-1);
    const open = attempt?.phase !== "released" && attempt?.phase !== "paid";
    const email = attempt?.contactSnapshot?.contact.email, hash = email && await stopKey(email);
    const send = !open && origin && ctx.email && email && mode !== "off" && (record.news || mode === "all") &&
      cartLines(record, now).length && !await ctx.storage[CART_EMAIL_STOPS]!.get(hash!);
    // Claimed before sending, so a second run never sends it again.
    if (!(await carts.compareAndSet(id, found.revision, open ? { ...record, remindAt: String(now + 3600) } : { ...rest, ...send ? { emailed: true } : {} })).applied || !send) continue;
    const [capabilityId, key] = (await mintGuestCapability({ runtimeSiteUrl: origin, host: { createCartId: () => id },
      capabilities: ctx.storage.checkout_guest_capabilities } as never, hash!)).presentation.capability.split(".");
    const link = `${origin}/cart/c/${capabilityId}?key=${key}`, name = ctx.site.name || new URL(origin).host;
    // The items are listed when the cart still holds what the shopper took to checkout.
    const same = JSON.stringify(record.cart!.lines) === JSON.stringify(attempt!.cart);
    const items = same ? attempt!.payment.lines.map(line => `${line.quantity} x ${line.name}${line.options ? ` (${line.options})` : ""}\n`).join("") + "\n" : "";
    await ctx.email!.send({ to: email, subject: `You left something in your cart at ${name}`,
      text: `You started checking out at ${name} but didn't finish.\n\n${items}Your cart is saved: ${link}\n\nTo stop cart reminder emails: ${link}&stop=1\n` });
  }
}
