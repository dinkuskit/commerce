import {
  PRODUCT_FEED_CHANNELS,
  type AgentCatalogFeed,
  type AgentCatalogProductEntry,
  type ProductAiProjection,
  type ProductFeedBuildOptions,
  type ProductFeedFacts,
  type ProductFeedPage,
  type ProductFeedChannel,
  type StorefrontAgentFeedOptions,
  type StorefrontShippingQuoteInput,
} from "./types.js";
import { formatMinorUnitsAsDecimal } from "../structured-data/index.js";

const DEFAULT_PAGE_SIZE = 100;
// Channel caps on secondary images: Google takes 10 additional_image_link
// elements, Meta 20 comma-separated URLs in one additional_image_link column.
const GOOGLE_ADDITIONAL_IMAGES = 10;
const META_ADDITIONAL_IMAGES = 20;
const MAX_PAGE_SIZE = 500;

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character]!);
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function price(product: ProductFeedFacts): string {
  const money = product.product.price;
  return money ? `${formatMinorUnitsAsDecimal(money)} ${money.currency}` : "";
}

// Each channel's value for the same status JSON-LD maps (backorder → BackOrder).
const AVAILABILITY_VALUES: Record<ProductFeedChannel, { inStock: string; backorder: string; outOfStock: string }> = {
  "google-merchant": { inStock: "in stock", backorder: "backorder", outOfStock: "out of stock" },
  "meta-catalog": { inStock: "in stock", backorder: "available for order", outOfStock: "out of stock" },
};

function availability(product: ProductFeedFacts, channel: ProductFeedChannel): string {
  const values = AVAILABILITY_VALUES[channel];
  switch (product.product.availability.status) {
    case "in-stock":
      return values.inStock;
    case "available-on-backorder":
      return values.backorder;
    default:
      return values.outOfStock;
  }
}

function eligible(product: ProductFeedFacts, channel: ProductFeedChannel): boolean {
  return product.eligibility.includes(channel) &&
    product.product.availability.listable &&
    product.product.price !== undefined &&
    product.content.canonicalUrl.length > 0 &&
    product.content.title.length > 0;
}

export function pageProductFeedRows(
  products: readonly ProductFeedFacts[],
  options: ProductFeedBuildOptions = {},
): ProductFeedPage {
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = options.cursor ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError("invalid feed cursor");
  const rows = products.slice(cursor, cursor + pageSize);
  return {
    rows,
    ...(cursor + rows.length < products.length ? { nextCursor: cursor + rows.length } : {}),
  };
}

export function buildGoogleMerchantFeed(products: readonly ProductFeedFacts[]): string {
  const rows = products.filter((product) => eligible(product, "google-merchant"));
  const items = rows.map((product) => {
    const image = product.content.imageUrls?.[0];
    return [
      "<item>",
      `<g:id>${escapeXml(product.product.id)}</g:id>`,
      `<g:title>${escapeXml(product.content.title)}</g:title>`,
      product.content.description ? `<g:description>${escapeXml(product.content.description)}</g:description>` : "",
      `<g:link>${escapeXml(product.content.canonicalUrl)}</g:link>`,
      image ? `<g:image_link>${escapeXml(image)}</g:image_link>` : "",
      ...(product.content.imageUrls ?? []).slice(1, 1 + GOOGLE_ADDITIONAL_IMAGES)
        .map((url) => `<g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`),
      `<g:price>${escapeXml(price(product))}</g:price>`,
      `<g:availability>${availability(product, "google-merchant")}</g:availability>`,
      "<g:condition>new</g:condition>",
      product.product.gtin ? `<g:gtin>${escapeXml(product.product.gtin)}</g:gtin>` : "",
      product.product.mpn ? `<g:mpn>${escapeXml(product.product.mpn)}</g:mpn>` : "",
      product.product.brand ? `<g:brand>${escapeXml(product.product.brand)}</g:brand>` : "",
      // Google's no-identifier signal: neither a GTIN nor brand plus MPN is on file.
      product.product.gtin || (product.product.brand && product.product.mpn) ? "" : "<g:identifier_exists>no</g:identifier_exists>",
      product.shipping ? `<g:shipping>${escapeXml(product.shipping)}</g:shipping>` : "",
      "</item>",
    ].filter(Boolean).join("");
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>${items}</channel></rss>`;
}

export function buildMetaCatalogFeed(products: readonly ProductFeedFacts[]): string {
  const columns = ["id", "retailer_id", "title", "description", "availability", "condition", "price", "link", "image_link", "additional_image_link", "brand", "gtin", "mpn", "shipping"];
  const rows = products.filter((product) => eligible(product, "meta-catalog")).map((product) => [
    product.product.id,
    product.product.id,
    product.content.title,
    product.content.description ?? "",
    availability(product, "meta-catalog"),
    "new",
    price(product),
    product.content.canonicalUrl,
    product.content.imageUrls?.[0] ?? "",
    (product.content.imageUrls ?? []).slice(1, 1 + META_ADDITIONAL_IMAGES).join(","),
    product.product.brand ?? "",
    product.product.gtin ?? "",
    product.product.mpn ?? "",
    product.shipping ?? "",
  ].map(csv).join(","));
  return [columns.map(csv).join(","), ...rows].join("\n") + "\n";
}

function normalizeAiProjection(projection: ProductAiProjection | undefined): ProductAiProjection | undefined {
  if (!projection) return undefined;
  const summary = projection.summary?.trim();
  const highlights = (projection.highlights ?? []).map((item) => item.trim()).filter(Boolean);
  const specsEntries = Object.entries(projection.specs ?? {})
    .map(([key, value]) => [key.trim(), String(value).trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  const shippingSummary = projection.shippingSummary?.trim();
  const returnPolicySummary = projection.returnPolicySummary?.trim();
  if (!summary && !highlights.length && !specsEntries.length && !shippingSummary && !returnPolicySummary) {
    return undefined;
  }
  return {
    ...(summary ? { summary } : {}),
    ...(highlights.length ? { highlights } : {}),
    ...(specsEntries.length ? { specs: Object.fromEntries(specsEntries) } : {}),
    ...(shippingSummary ? { shippingSummary } : {}),
    ...(returnPolicySummary ? { returnPolicySummary } : {}),
  };
}

function hasPricedListableMember(product: ProductFeedFacts): boolean {
  const members = product.product.variants?.members;
  if (!members?.length) return false;
  return members.some((member) => member.availability.listable && member.price !== null && member.price !== undefined);
}

function agentEligible(product: ProductFeedFacts): boolean {
  return (
    product.eligibility.length > 0 &&
    product.product.availability.listable &&
    (product.product.price !== undefined || hasPricedListableMember(product)) &&
    product.content.canonicalUrl.trim().length > 0 &&
    product.content.title.trim().length > 0
  );
}

function resolveProductFulfillment(product: ProductFeedFacts): "physical" | "digital" | undefined {
  if (product.product.fulfillment === "physical" || product.product.fulfillment === "digital") {
    return product.product.fulfillment;
  }
  const members = product.product.variants?.members ?? [];
  if (!members.length) return undefined;
  const values = new Set(members.map((member) => member.fulfillment));
  return values.size === 1 ? [...values][0] : undefined;
}

function shippingSummaryLine(shipping: StorefrontShippingQuoteInput | null | undefined): string {
  if (!shipping) return "Calculated at checkout in USD minor units (cents); digital-only orders pay 0 shipping.";
  if (shipping.mode === "free") return "Free shipping ($0.00 USD; 0 minor units).";
  const flat = shipping.amount ? `$${formatMinorUnitsAsDecimal(shipping.amount)} USD (${shipping.amount.minor} minor units)` : "flat rate";
  if (shipping.freeOver) {
    return `Flat ${flat}; free when discounted net merchandise (netMerchandise) is at least $${formatMinorUnitsAsDecimal(shipping.freeOver)} USD (>= ${shipping.freeOver.minor} minor units, inclusive, after coupon discounts). Digital-only orders pay 0 shipping.`;
  }
  return `Flat ${flat}. Digital-only orders pay 0 shipping.`;
}

export function buildAgentCatalogFeed(options: StorefrontAgentFeedOptions): AgentCatalogFeed {
  const origin = options.siteOrigin.replace(/\/+$/, "");
  const products: AgentCatalogProductEntry[] = options.products
    .filter(agentEligible)
    .map((row) => {
      const money = row.product.price;
      const aiProjection = normalizeAiProjection(row.content.aiProjection);
      const description = row.content.description?.trim();
      const fulfillment = resolveProductFulfillment(row);
      const variantMembers = (row.product.variants?.members ?? [])
        .filter((member) => member.availability.listable && member.price !== null && member.price !== undefined)
        .map((member) => ({
          catalogItemId: member.catalogItemId,
          selections: member.selections,
          price: {
            currency: "USD" as const,
            minor: member.price!.minor,
            formatted: `$${formatMinorUnitsAsDecimal(member.price!)} USD`,
          },
          availability: {
            status: member.availability.status,
            sellable: member.availability.sellable,
          },
          fulfillment: member.fulfillment,
        }));
      return {
        id: row.product.id,
        sku: row.product.sku,
        title: row.content.title.trim(),
        canonicalUrl: row.content.canonicalUrl.trim(),
        ...(description ? { description } : {}),
        imageUrls: [...(row.content.imageUrls ?? [])],
        ...(money
          ? {
              price: {
                currency: "USD",
                minor: money.minor,
                formatted: `$${formatMinorUnitsAsDecimal(money)} USD`,
              },
            }
          : {}),
        availability: {
          status: row.product.availability.status,
          sellable: row.product.availability.sellable || variantMembers.some((member) => member.availability.sellable),
        },
        ...(fulfillment ? { fulfillment } : {}),
        ...(row.product.variants && variantMembers.length
          ? {
              variants: {
                productId: row.product.variants.productId,
                options: row.product.variants.options,
                members: variantMembers,
              },
            }
          : {}),
        ...(row.product.brand ? { brand: row.product.brand } : {}),
        ...(row.product.gtin ? { gtin: row.product.gtin } : {}),
        ...(row.product.mpn ? { mpn: row.product.mpn } : {}),
        ...(aiProjection ? { aiProjection } : {}),
      };
    });

  return {
    schema: "dinkuskit.commerce.agent-catalog-feed/v1",
    storeName: options.storeName.trim(),
    siteOrigin: origin,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    virtualCardSizing: {
      currency: "USD",
      taxMinor: "0",
      taxPolicy: "uncollected-zero",
      shipping: options.shipping ?? null,
      formula: "subtotalMinor - couponDiscountMinor + shippingMinor + taxMinor(0) = totalMinor",
    },
    products,
    policies: [...(options.policies ?? [])],
  };
}

export function buildStorefrontLlmsTxt(options: StorefrontAgentFeedOptions): string {
  const feed = buildAgentCatalogFeed(options);
  const lines: string[] = [
    `# ${feed.storeName}`,
    "",
    `> ${feed.description ?? `${feed.storeName} storefront powered by DinkusKit Commerce on EmDash CMS.`}`,
    "",
    "## Storefront & Agent Discovery",
    `- [Full Catalog & Policy Corpus (llms-full.txt)](${feed.siteOrigin}/llms-full.txt): Complete product specs, AI projections, store policies, and checkout contract.`,
    `- [Shopping Agent & Virtual Card Guide (agents.md)](${feed.siteOrigin}/agents.md): Machine-readable guest checkout API and single-use virtual card sizing instructions.`,
    `- [Storefront Home](${feed.siteOrigin}/): Public HTML storefront.`,
    `- [Google Merchant Feed](${feed.siteOrigin}/feeds/google-merchant.xml): RSS 2.0 XML product feed.`,
    `- [Meta Catalog Feed](${feed.siteOrigin}/feeds/meta-catalog.csv): CSV product feed.`,
    "",
    `## Products (${feed.products.length})`,
  ];

  if (feed.products.length === 0) {
    lines.push("- No public products are currently listed.");
  } else {
    for (const item of feed.products) {
      const blurb = item.aiProjection?.summary ?? item.description ?? "";
      const summarySuffix = blurb ? ` — ${blurb}` : "";
      const priceLabel = item.price
        ? `${item.price.formatted} (${item.price.minor} minor units)`
        : item.variants?.members.length
          ? (() => {
              const lowest = item.variants.members.reduce((min, candidate) =>
                BigInt(candidate.price.minor) < BigInt(min.price.minor) ? candidate : min
              );
              return `from ${lowest.price.formatted} (${item.variants.members.length} variants)`;
            })()
          : "see options";
      const fulfillmentPart = item.fulfillment ? `, ${item.fulfillment}` : "";
      lines.push(
        `- [${item.title}](${item.canonicalUrl}): ${priceLabel}, ${item.availability.status}, SKU \`${item.sku}\`${fulfillmentPart}${summarySuffix}`,
      );
    }
  }

  if (feed.policies.length > 0) {
    lines.push("", "## Store Policies");
    for (const policy of feed.policies) {
      lines.push(`- [${policy.title}](${policy.url})`);
    }
  }

  lines.push(
    "",
    "## Checkout & Virtual Card Sizing",
    `- Currency: \`${feed.virtualCardSizing.currency}\` (integer minor units / cents)`,
    `- Tax: \`${feed.virtualCardSizing.taxMinor}\` minor units (\`taxPolicy: ${feed.virtualCardSizing.taxPolicy}\`)`,
    `- Shipping: ${shippingSummaryLine(feed.virtualCardSizing.shipping)}`,
    `- Formula: \`${feed.virtualCardSizing.formula}\``,
    "",
  );
  return lines.join("\n");
}

export function buildStorefrontLlmsFullTxt(options: StorefrontAgentFeedOptions): string {
  const feed = buildAgentCatalogFeed(options);
  const lines: string[] = [
    buildStorefrontLlmsTxt(options).trimEnd(),
    "",
    "---",
    "",
    "## Detailed Product Projections",
  ];

  for (const item of feed.products) {
    lines.push(
      "",
      `### ${item.title}`,
      `- Canonical URL: ${item.canonicalUrl}`,
      `- Product ID: \`${item.id}\``,
      `- SKU: \`${item.sku}\``,
    );
    if (item.price) {
      lines.push(`- Price: ${item.price.formatted} (\`minor: "${item.price.minor}"\`, \`currency: "${item.price.currency}"\`)`);
    }
    lines.push(`- Availability: \`${item.availability.status}\` (\`sellable: ${item.availability.sellable}\`)`);
    if (item.fulfillment) {
      lines.push(`- Fulfillment: \`${item.fulfillment}\``);
    }
    if (item.variants?.members.length) {
      lines.push(`- Variants (${item.variants.members.length}):`);
      for (const member of item.variants.members) {
        const sel = member.selections.map((s) => `${s.optionLabel}: ${s.valueLabel}`).join(", ");
        lines.push(
          `  - \`catalogItemId: "${member.catalogItemId}"\` (${sel || "default"}): ${member.price.formatted} (\`minor: "${member.price.minor}"\`), \`${member.availability.status}\`, \`sellable: ${member.availability.sellable}\`, \`fulfillment: "${member.fulfillment}"\``,
        );
      }
    }
    if (item.brand) lines.push(`- Brand: ${item.brand}`);
    if (item.gtin) lines.push(`- GTIN: \`${item.gtin}\``);
    if (item.mpn) lines.push(`- MPN: \`${item.mpn}\``);
    if (item.aiProjection?.summary) {
      lines.push(`- Summary: ${item.aiProjection.summary}`);
    } else if (item.description) {
      lines.push(`- Description: ${item.description}`);
    }
    if (item.aiProjection?.highlights?.length) {
      lines.push(`- Highlights: ${item.aiProjection.highlights.join("; ")}`);
    }
    if (item.aiProjection?.specs && Object.keys(item.aiProjection.specs).length > 0) {
      const specsText = Object.entries(item.aiProjection.specs)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      lines.push(`- Specs: ${specsText}`);
    }
    if (item.aiProjection?.shippingSummary) {
      lines.push(`- Shipping Note: ${item.aiProjection.shippingSummary}`);
    }
    if (item.aiProjection?.returnPolicySummary) {
      lines.push(`- Return Policy Note: ${item.aiProjection.returnPolicySummary}`);
    }
  }

  if (feed.policies.length > 0) {
    lines.push("", "---", "", "## Store Policies Corpus");
    for (const policy of feed.policies) {
      lines.push("", `### ${policy.title}`, `Canonical URL: ${policy.url}`);
      if (policy.body?.trim()) {
        lines.push("", policy.body.trim());
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function buildStorefrontAgentsMd(options: StorefrontAgentFeedOptions): string {
  const feed = buildAgentCatalogFeed(options);
  const pluginId = options.pluginId?.trim() || "r_gshdrqaldna3r7sn";
  const pluginBase = `${feed.siteOrigin}/_emdash/api/plugins/${pluginId}`;
  const domSelector = options.checkoutBreakdownSelector?.trim();
  const domLines = domSelector
    ? [
        "",
        "### Checkout DOM Attributes (`/checkout`)",
        `On the \`/checkout\` page, \`${domSelector}\` exposes live integer minor-unit attributes alongside formatted USD strings:`,
        "- `data-checkout-currency=\"USD\"`",
        "- `data-checkout-subtotal-minor=\"<integer-cents>\"`",
        "- `data-checkout-shipping-minor=\"<integer-cents>\"`",
        "- `data-checkout-tax-minor=\"0\"`",
        "- `data-checkout-total-minor=\"<integer-cents>\"`",
      ]
    : [];
  return [
    `# Shopping Agent & Virtual Card Contract — ${feed.storeName}`,
    "",
    `> Canonical machine-readable operating guide for autonomous shopping agents, price comparison crawlers, and single-use virtual card issuers interacting with ${feed.storeName} (${feed.siteOrigin}).`,
    "",
    "## 1. Discovery & Structured Feeds",
    `- **Concise LLM Index**: \`GET ${feed.siteOrigin}/llms.txt\``,
    `- **Full Catalog & Policy Corpus**: \`GET ${feed.siteOrigin}/llms-full.txt\``,
    `- **Live Public Catalog JSON API**: \`GET ${pluginBase}/catalog/public\` (installed plugin runtime ID \`${pluginId}\`; paginate while \`data.cursor\` is present)`,
    `- **Single Item JSON API**: \`GET ${pluginBase}/catalog/public/item?itemId=<id>\` (or \`?pageId=<pageId>\`)`,
    `- **Google Merchant XML Feed**: \`GET ${feed.siteOrigin}/feeds/google-merchant.xml\``,
    `- **Meta Catalog CSV Feed**: \`GET ${feed.siteOrigin}/feeds/meta-catalog.csv\``,
    "",
    "## 2. Deterministic Virtual Card Sizing (`USD` Minor Units)",
    "Agents provisioning single-use virtual payment cards (Stripe Issuing, Privacy, Lithic, Ramp, or consumer agent wallets) can compute the exact payable total in USD minor units (cents) before or during checkout:",
    `- **Currency**: \`${feed.virtualCardSizing.currency}\``,
    `- **Tax**: Always \`${feed.virtualCardSizing.taxMinor}\` minor units (\`tax: { currency: "USD", minor: "0" }\`). Tax is not added at payment session creation.`,
    `- **Shipping**: ${shippingSummaryLine(feed.virtualCardSizing.shipping)}`,
    `- **Exact Total Formula**: \`${feed.virtualCardSizing.formula}\``,
    ...domLines,
    "",
    "## 3. Guest Checkout API Protocol",
    "For every guest checkout call, verify HTTP status 200, the EmDash transport wrapper `success === true`, and Commerce's `data.ok === true` before reading `data`.",
    `1. **Prepare Capability**: \`POST ${pluginBase}/checkout/guest/prepare\` with an empty JSON body \`{}\` and same-origin \`Origin\` header (\`sec-fetch-site: same-origin\`). Retain the capability token string at \`data.capability.capability\` from the JSON response and send it on subsequent requests via the \`x-commerce-guest-capability\` header. Also inspect \`data.contactRequirements.requirePhoneNumber\` to determine whether \`contact.phone\` is required.`,
    `2. **Start Checkout & Freeze Pricing**: \`POST ${pluginBase}/checkout/guest/start\` with header \`x-commerce-guest-capability: <token>\`, \`lines: [{ catalogItemId, quantity }]\` (for products with options, use the chosen sellable member's \`catalogItemId\` from \`variants.members\`), optional \`couponCode\` on self-hosted stores only (omit \`couponCode\` on Registry stores, where coupon codes are refused with \`COUPON_UNAVAILABLE\`), and \`contact\`:`,
    "   - `email` (required)",
    "   - `phone` (required when `data.contactRequirements.requirePhoneNumber === true`)",
    "   - `billing`: required on every checkout (including digital-only orders) with `{ name, line1, line2?, city, region?, postalCode, country }` (`country` as 2-letter ISO code)",
    "   - `delivery`: required when a line has `fulfillment: \"physical\"`, with `{ name, line1, line2?, city, region?, postalCode, country }` in a shipping destination supported by the store (published in the storefront shipping policy; US delivery requires a valid 2-letter state or full state name in `region`)",
    "   - The response `data.checkout.pricing` object contains:",
    "     - `merchandiseSubtotal: { currency: \"USD\", minor: \"...\" }`",
    "     - `couponDiscount: { currency: \"USD\", minor: \"...\" }`",
    "     - `netMerchandise: { currency: \"USD\", minor: \"...\" }`",
    "     - `shipping: { mode: \"free\" | \"flat\", charge: { currency: \"USD\", minor: \"...\" } }`",
    "     - `tax: { currency: \"USD\", minor: \"0\" }`",
    "     - `finalTotal: { currency: \"USD\", minor: \"...\" }`",
    "   - Size the virtual card to `data.checkout.pricing.finalTotal.minor` (in USD cents) and navigate to `data.checkout.redirectUrl` (when `data.checkout.state === \"pending\"` and `data.checkout.redirectUrl` is non-null; zero-total checkouts complete immediately with `data.checkout.state === \"paid\"`).",
    `3. **Poll Status / Receipt**: \`POST ${pluginBase}/checkout/guest/status\` with header \`x-commerce-guest-capability: <token>\` and JSON body \`{}\` (or \`{ "attemptId": "<data.checkout.attemptId>" }\`). Bound pending-status checks (at most 5 checks per attempt):`,
    "   - When `data.checkout.state === \"paid\"`, read `data.checkout.order` (`orderId`, `receiptId`, `lines`, `total`, `pricing`).",
    "   - When `data.checkout.state === \"released-retry\"` or `\"recoverable-failure\"`, stop polling that attempt immediately; retain the existing `x-commerce-guest-capability` token and issue a fresh `POST .../checkout/guest/start` before polling again.",
    "",
  ].join("\n");
}

export { PRODUCT_FEED_CHANNELS };
