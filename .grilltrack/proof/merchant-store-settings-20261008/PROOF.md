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
