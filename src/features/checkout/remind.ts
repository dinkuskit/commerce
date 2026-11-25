import type { EmailBeforeSendEvent, EmailMessage, PluginContext, StorageCollection } from "emdash";
import { mintGuestCapability } from "./capability.js";
import { cartLines, stopKey } from "./guest.js";
import { currentAttempt } from "./orchestrate.js";
import { canonicalizeHttpOrigin } from "./site-scope.js";
import type { CheckoutRecord } from "./types.js";

export const CART_EMAIL_STOPS = "cart_email_stops";

/**
 * A left cart (store-emails-plugin-20261122), from the background check 10 hours after the shopper gave an email
 * at checkout: once the checkout ended unpaid, the cart still holds something and the address has not stopped cart
 * emails, it becomes the courier's `cart.left` news, at most once per cart. Store emails decides whether to email it.
 * A checkout still open is looked at again an hour on.
 *
 * The emailed cart link's key is made here, once, and kept on the cart beside `leftKey`: the courier may read the
 * same news again, and a key made at each read would leave an email already sent with a link that no longer works.
 * `leftAttempt` names the checkout that key was made for: a later checkout under another email changes neither the
 * news's address nor the address its stop link stops.
 */
export async function remindCarts(ctx: PluginContext, now: number): Promise<void> {
  const carts = ctx.storage.checkout_carts as StorageCollection<CheckoutRecord>;
  const origin = canonicalizeHttpOrigin(ctx.site.url);
  for (const { id } of (await carts.query({ where: { remindAt: { lt: String(now) } }, limit: 5 })).items) {
    const found = await carts.getVersioned(id);
    const record = found?.value;
    if (!found || !record?.remindAt || +record.remindAt > now) continue;
    const { remindAt: _, ...rest } = record;
    const attempt = currentAttempt(record.attempts);
    if (attempt?.phase !== "released" && attempt?.phase !== "paid") {
      await carts.compareAndSet(id, found.revision, { ...record, remindAt: String(now + 3600) });
      continue;
    }
    const email = attempt.contactSnapshot?.contact.email, hash = email && await stopKey(email);
    const left = attempt.phase === "released" && origin && hash && cartLines(record, now).length && !await ctx.storage[CART_EMAIL_STOPS]!.get(hash);
    let link: string | undefined;
    if (left) {
      const [capabilityId, key] = (await mintGuestCapability({ runtimeSiteUrl: origin, host: { createCartId: () => id },
        capabilities: ctx.storage.checkout_guest_capabilities } as never, { emailHash: hash, emailAttempt: attempt.attemptId })).presentation.capability.split(".");
      link = `${origin}/cart/c/${capabilityId}?key=${key}`;
    }
    // A lost write leaves only an unused key behind, which dies with the cart.
    await carts.compareAndSet(id, found.revision, { ...rest, ...link && { leftKey: `${new Date(now * 1000).toISOString()} ${id}`, leftLink: link, leftAttempt: attempt.attemptId } });
  }
}

/**
 * A cart email still waiting or being retried when its shopper stops cart emails is refused at send time
 * (cart-email-stop-at-send-20261123), as Klaviyo re-checks before each send. Only an email carrying the store's
 * cart stop link is looked at. It throws rather than returning false, which EmDash would report as sent.
 */
export async function refuseStoppedCartEmail({ message }: EmailBeforeSendEvent, ctx: PluginContext): Promise<EmailMessage> {
  if (/\/cart\/c\/[^\s"'<>]*?[?&](?:amp;)?stop=1(?![0-9A-Za-z])/.test(message.text + message.html) && await ctx.storage[CART_EMAIL_STOPS]!.get(await stopKey(message.to)))
    throw Error("CART_EMAIL_STOPPED: This shopper stopped cart emails.");
  return message;
}
