# Commerce products admin

The EmDash admin Products page lists Commerce catalog products by name and
lets a clerk add one with a name and SKU. Manage Stock is not on the form.
Opening a product shows Regular and Sale.

The clerk types dollars (`12`, `12.00`, `12.5`, or `$12`). Commerce stores
Money `{ currency: "USD", minor }`. A blank Sale clears Sale. A blank Regular
unprices the product after Sale is cleared. `$0` stays a free product and
shows `0.00`.

`12.999`, a letter, or a minus is refused. Sale that is not lower than
Regular is refused. Clearing Regular while a Sale remains is refused. A
refusal leaves the stored price unchanged and the page says why.

Products stay catalog records. They are not an EmDash content collection.

## Shipping weight

Each physical product has an optional shipping weight in ounces (GrillTrack
`commerce-product-weight-001`), set in the Shipping weight form on its
Registry Products page. A product with choices shows one weight per physical
choice. The owner types up to two decimals, above 0 and up to 2400 oz
(150 lb); a blank clears it. One unusable weight refuses the whole form, so
nothing is half saved, and the form keeps what was typed.

Commerce stores it as `weightOz` on the catalog item. Shoppers never see it
and product feeds do not carry it. The paid-order record is unchanged: when
the Ship handoff is built, its label form starts from the products' current
weights plus the chosen box. Digital products have no weight. The native
development admin does not show the form.
