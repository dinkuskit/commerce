# Merchant store settings checkpoint

Base: e6a77860bb9c90a1eff3be00ee8a14254960fb6d.

Confirmed decisions: merchant-country-settings-001 and merchant-phone-requirement-001.
One plugin-scoped merchantStoreSettings record uses EmDash getVersioned/compareAndSet.
Phone is off by default and does not require country setup. Country lists are separate;
first country save defaults omitted lists to the selected country, while later country
changes preserve lists. Country eligibility is not enforced by checkout in this slice.

Independent Node 22.23.2 proof: TypeScript compilation passes and 12 focused Node tests
pass with no failures/skips. Tests use real SQLite OptionsRepository/createSettingsAccess,
SDK permissions, and BlockKit validation. They cover phone-before-country, first-save UI
defaults, independent/empty lists, corrupt or unreadable settings, invalid inputs, CAS
concurrency across host contexts, unchanged storage after rejected writes, stale draft
revision retention and repeated retry refusal, explicit reload, and storage outages.

ACP implementation job completed with cleanup confirmed. Parent rejected and repaired
first-save blank-list behavior and refreshed conflict tokens before accepting this checkpoint.

This checkpoint does not claim installed browser proof or shared registration completion.
Native Store receives an additive BlockRenderer section; existing catalog controls remain.
Native/Registry registration, official composed bundle measurement, full verification,
exact-source independent review, native review, and CI are still pending.

Official baseline bundle: 129476 bytes; limit: 131072 bytes. No cap increase or custom
size transform is introduced by this feature.

## Composed checkpoint

Frozen dependency: 631d3b9fac6e55f1af4d8ff100ee48d487d83efa (variant PR67).
CLI reconciliation approved and applied with digest
a51a81cff81f0beca975969b7b448b799ebabd703ca91443f8ecb7c5ab82b5a0;
base e6a77860bb9c90a1eff3be00ee8a14254960fb6d, country checkpoint
369f5cf40def3d51a4c8483b99a15eafd9e55b3d, incoming frozen dependency above.
History is retained and composed decisions honestly need new verification.

Shared registration is now wired: Registry existing private admin Settings appends
merchant form; native Store adds the same BlockRenderer form via private
merchant-store-settings route with the existing content:edit_any permission.
Package export and unit-test glob are additive. No manifest grant change.

Composed TypeScript/official build,12 focused tests, repo audit and diff check pass.
Official dist/sandbox/plugin.mjs is137860 bytes, SHA256
27036796b600a418c35a08ffff4b2394b467ff24dcc57fe31fbe5c439a3a3162,
which EXCEEDS131072 by6788. Build emission is not Registry installation acceptance.
The coordinator routed a separate behavior-preserving headroom refactor.
Full native/Registry browser proof and review remain pending.
