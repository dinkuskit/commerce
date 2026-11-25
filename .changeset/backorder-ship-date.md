---
"@dinkuskit/commerce": minor
---

A product or variant on backorder gets an Expected ship date box under Stock status. The public catalog sends the date as `availability.shipBy`, the Google feed sends it as `availability_date` and leaves out a backorder row with no usable date (Google requires one), and `backorderShipDate` gives hosts the same rule for the product page. Once a date passes the box's label says so. To make room in the Registry backend, the Registry build drops the setup-pending stock refusal it can never reach, and the store settings notes are shorter.
