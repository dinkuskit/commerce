---
"@dinkuskit/commerce": patch
---

Commerce makes room for Tax. A saved checkout setting that still names the retired isolated Ship TEST profile (0.3.0-beta.0 to beta.2) is now refused like any other form of it, so checkout stays closed until the store connects again through DinkusKit.com. The Registry build also leaves out the inventory checkout errors only a managed-stock item can raise, and checks payment windows with shorter code (no behaviour change). The Registry backend goes from 131,057 to 130,370 bytes.
