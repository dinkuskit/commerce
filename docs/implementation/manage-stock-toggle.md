# Persist Manage stock on the Products page

The Products Save writes Manage stock with Regular, Sale, and stock status.
New products still default off. Checking the box persists `setup-required`.
It does not run Configure Inventory, invent a quantity, or open an install
walk. Unchecking restores the dormant In stock / Out of stock / On backorder
value, drops reconstructable Commerce registration claims with
`compareAndDelete`, and does not contact Inventory. Pool quantity stays on
the Inventory SKU. The catalog row uses `compareAndSet` so a concurrent
Configure Inventory write cannot overwrite a disable. Uncheck is refused while
setup is still running so that in-flight registration can finish talking to
Inventory; the clerk retries Save after it finishes. A refused Manage stock
write leaves stored prices unchanged.
