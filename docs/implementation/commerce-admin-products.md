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
