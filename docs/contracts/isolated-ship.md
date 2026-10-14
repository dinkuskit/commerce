# Isolated Ship TEST cohort v1

This optional profile admits one explicitly approved fresh TEST order to a separate recipient. It preserves existing paid orders and production Ship configuration. Source support does not activate a deployment, grant, key, payment or order.

## Connection and authority

`installedCheckout.ship` accepts production `{origin,audience}` unchanged. The isolated shape is exact `{origin:"https://ship.sm0ky.dev",audience:"dinkus-ship-sandbox",recipient:"ship-sandbox",generation,mode:"test"}`. Generation matches `^[A-Za-z0-9_-]{1,128}$`; the Checkout payment mode cannot be live. Missing or partial isolation fields, arbitrary origins/audiences and live isolation fail closed. The manifest declares the exact host; the installation still needs an approved effective host grant.

The same existing store key is traded only at the fixed issuer endpoint. Sandbox trades add expected `generation`; admitted passes require existing issuer/site/scope/time claims plus `ship_recipient`, `ship_generation`, `ship_mode:"test"`. Commerce's claim admission does not replace the receiver's cryptographic signature verification. Production passes refuse additive sandbox claims.

The issuer owns registered recipient/generation/site authorization. The receiver owns a deployment-configured single allowed canonical order ID, empty by default. Configuring that ID requires an independently approved fresh paid TEST proof after isolated readiness. Commerce does not infer freshness from an order number, timestamp or revision. Its local owner admission is one half of the gate; receiver exact-ID validation remains mandatory.

## Supported private actions

The existing private `orders` route requires `plugins:manage`, API admin scope and owner role50.

- `{action:"ship.admit",orderId,version:1,generation}` resolves current isolated configuration server-side. It requires explicit TEST, Processing, unacknowledged revision1. It CAS-pins immutable recipient/generation/enabled metadata beside the frozen paid order without changing its number or business revision. Same enabled pin returns duplicate; an incompatible pin conflicts; a disabled pin cannot be re-enabled by admission.
- `{action:"cohort.disable",orderId,generation}` CAS-disables the same order record without changing its paid snapshot or business revision. Pin remains forever. This action works even after configuration removal, so rollback does not depend on an available remote service.

IDs must be nonempty, single-line and at most200 characters. Owner admission is not a payment replay or general historical migration. Existing shipVersion markers are not reset or attributed to a destination.

## Wire and effects

Isolated POST `/v1/orders`, GET `/v1/labels`, POST `/v1/labels/ack` carry `X-Ship-Recipient`, `X-Ship-Generation`, `X-Ship-Mode`. Bodies remain compatible; ACK body is `{eventId}`. Isolated intake and ACK receipts and label events carry `{recipient,generation,mode}` matching signed claims and deployment. GET returns the existing array shape. Receiver gates exact site/generation/allowed ID/TEST before state or provider effects. Production receiver must reject sandbox claims/headers rather than ignore them.

Outgoing sandbox orders require the enabled immutable pin and explicit TEST. Returned label completion uses the enabled matching pin in the SAME storage CAS as completion. Generation-scoped acknowledgements apply only to the new cohort; the old shipVersion remains untouched. Disable and completion/ack races serialize on the order storage revision. Foreign/unadmitted/disabled label events are not completed or acknowledged; receiver must provide bounded quarantine/filtered delivery so foreign events cannot fill its list indefinitely.

Current configuration is re-admitted before accepting isolated effects/results. An invocation already holding a connection can outlive a settings edit; a settings re-read is not a transaction with order storage. Supported disable first establishes atomic local fencing. Receiver active-generation validation and operational quiescence remain necessary to stop already-transmitted calls and old sessions/passes. No instant revocation or cross-service provider dedupe is claimed.

A pin prevents legacy sends/completion and remains after disable or configuration removal. Rollback disables the cohort first and reconciles pending effects with the receiver owner; it never reroutes the order to production, changes a historical paid record, or resets a key. Orders page load and saved changes trigger sync; cron also reconciles payments before sync. Read-only acceptance must use private show/list rather than opening the syncing page.

Ship owns independent no-email suppression, TEST-only provider isolation and effect proofs. Commerce sends a TEST mark and existing contact facts; neither the mark nor an absent email binding establishes no-email behavior.
