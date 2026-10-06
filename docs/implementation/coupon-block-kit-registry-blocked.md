# Coupon Registry Block Kit contract and admission boundary

Commerce exposes a host-rendered coupon page through its existing sandbox
admin route. Products and Settings retain `content:edit_any`; every coupon page
and action checks the host-attested caller with the genuine public EmDash
`hasPermission` and `toRoleLevel` helpers for `plugins:manage`, before opening
coupon storage. Input-body user, role, UI and permission fields confer no
privilege. The manifest declares normalized-code uniqueness and the coupon page.

The page uses the existing coupon controller, evaluator, aggregate and usage
owner for list/create/edit/disable. Invalid drafts are retained. A stale edit
retains its original CAS revision until reopened. Fixed amounts round-trip with
integer money arithmetic. This does not add a money or order writer, stock
provider, payment integration or coupon checkout authority.

## Audited packaging

The initial public-helper dependency prebundle produced a 216,639-byte backend
and failed the official 131,072-byte decompressed file cap. The supported public
RBAC entry still has a large authentication closure in the pinned 1.0.1 package.
Commerce now prebundles browser dependencies before the official plugin builder,
using a narrowly scoped TypeScript AST transform on exact, hash-guarded auth
modules. Unexpected package bytes, closure files, source or initializer bytes
fail the build. There is no private auth entry, copied permission implementation,
blanket side-effect setting or gzip cap workaround.

Three unused schema initializers (`httpUrl`, `oauthProviderSchema`,
`authConfigSchema`) receive pure-call annotations. The audited six auth modules
contain declarations, immutable constants/maps, schema construction and function
bodies; they perform no import-time network request, credential read, global
registration, timer or persistent write. OAuth provider schemas only construct
validators. The passkey entry re-exports declarations. The authentication helper
module defines functions and local constants/maps; crypto/passkey operations run
only when called. The role map needed by `toRoleLevel` remains in the emitted
helper. Equivalence tests compare unmodified and optimized public helper bundles
for every declared permission and valid/invalid roles, including thrown outcomes.
These assertions are specific to the guarded source, not a claim about future
upstream versions or all modules in those dependency packages.

`node scripts/coupon-catalog.mjs --write` extracts literal `t(message)` calls with
the TypeScript parser and compiles the complete English catalog through Lingui
5.9.5. Builds reject dynamic descriptors and missing/stale compiled messages.
The production entry has no runtime message compiler. Each request creates its
own i18n instance; the host still supplies locale and direction. English is the
only shipped translation. An Arabic host locale displays English fallback coupon
messages in the host's RTL layout; this is not an Arabic coupon translation.

Actual installed-profile verification found that product uniqueness checks had
assumed the config plugin ID in SQLite index names. The sandbox now supplies the
trusted `PluginContext.plugin.id` to the existing exact-index proof. Native
callers retain their default namespace. Clerk input cannot choose the namespace;
foreign or unnamed constraint failures remain unconfirmed.

## Proof fidelity and remaining gate

The local installed profile loads the exact official artifact through EmDash
1.0.1's Registry state/storage loader and real workerd sandbox under the derived
Registry ID, with no configured Commerce descriptor. The disposable fixture
seeds unsigned local install state and invokes the genuine index materializer.
This proves installed-runtime HTTP dispatch, host-rendered Block Kit and storage
behavior. It does not exercise authoritative publisher records, signature
verification, aggregator admission, site consent or an actual published Registry
install. The concrete next gate is an owner-approved Registry release/install of
the frozen validated artifact and its declared public routes. No new plugin
network or credential grant is needed by coupon administration.

Scope-policy probes use the production dispatcher with explicit test scopes and
a host-authenticated local caller. They do not mint or test bearer credentials.
Selected visible evidence and exact bytes/hashes belong in the linked proof packet.
Historical failed builds and fixture runs are retained as such. Publishing,
deployment, permissions/provider changes and merge remain separate owner gates.
