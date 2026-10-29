---
"@dinkuskit/commerce": patch
---

Remove the "Allowed selling/customer countries" box from Commerce settings. Nothing enforced it; checkout only checks shipping destinations. Saved lists stay stored so older records and seeds still load, and a stale form that still sends the box is ignored.
