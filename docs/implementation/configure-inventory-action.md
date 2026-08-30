# Configure Inventory action

This slice gives Commerce a durable store identity and a private product action
that can start the existing managed-SKU registration contract. It does not add
a live Inventory transport or visual setup flow.

## Store configuration

Commerce stores one active `StoreInventoryConfigurationRecord`:

```ts
interface StoreInventoryConfigurationRecord {
  recordKind: "store-inventory-configuration";
  recordId: string;
  configurationKey: "active";
  siteId: string;
  binding: {
    providerRef: string;
    poolId: string;
    defaultFulfillmentLocationId: string;
  };
  configuredAt: string;
  updatedAt: string;
}
```

`siteId` is generated once by Commerce. A browser cannot provide or replace
it, and site name or URL changes do not alter it. EmDash 0.35 exposes site name
and URL as useful display metadata, but it does not provide a permanent opaque
site identity suitable for this key.

The `configurationKey` unique index is asserted at runtime before the first
configuration write. Concurrent first-time configuration attempts therefore
converge on the one stored record and its one winning `siteId`. If the index is
missing or cannot be identified exactly, Commerce fails closed.

Repeating the same binding is idempotent. The default fulfillment location may
be updated without changing the site identity. Changing the provider or pool
returns `migration-required` and does not mutate the binding. Pool migration is
deferred until the complete Commerce, Inventory, Blocks, and mounted-site stack
has live proof.

## Product action

The authenticated `catalog-items/configure-inventory` route requires EmDash
`content:edit_any` permission and accepts exactly:

```json
{ "catalogItemId": "catalog-item-id" }
```

Commerce loads the canonical SKU, product title, Manage Stock state, site
identity, provider reference, pool, and default location from server-owned
storage. Caller-supplied values for those fields are rejected.

If the store configuration is absent or incomplete, the action returns:

```json
{
  "outcome": "inventory-setup-required",
  "catalogItemId": "catalog-item-id",
  "actionLabel": "Configure Inventory"
}
```

That result performs no registration claim, provider resolution, provider
call, or catalog write. Unmanaged products are also rejected until Manage Stock
is enabled.

With a valid configuration, the action resolves the configured provider
through an injected `InventoryProviderPort`, creates or joins the existing
atomic registration claim, and persists each registration state in the catalog
record. Pending, review-required, and active products do not start a second
operation.

## Runtime boundary

The package root can receive a provider resolver when the plugin is composed:

```ts
createPlugin({
  inventorySetup: {
    resolveProvider: async (configuration) => inventoryProvider,
  },
});
```

The default plugin has no provider resolver. A configured product therefore
returns `PROVIDER_UNAVAILABLE` before any claim or catalog mutation until a
separately verified connector is installed.

This slice deliberately contains no HTTP client, service binding lookup,
Cloudflare OAuth, credentials, pool discovery, stock quantity, reservation,
stock movement, checkout behavior, visual admin UI, or pool migration.
