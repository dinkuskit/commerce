# Payment mode review adjudication

ClawSweeper reviewed commerce#96 at source a61b56f9aa211783989d85b3d8aa6aaf4e858be2 against main 3373a699f376 (review comment 6101634437, 20:01 UTC 2026-10-10).

Accepted P1 "Freeze the payment mode on the checkout attempt" and its matching security item "Payment mode can drift before final lookup". Classification required_fix. Checkout wrote the order's mode from the store setting read at completion, and the attempt kept no mode, so a checkout started while the store was test could be looked up and finished as a live order after the store and Payments both switched to live, or the reverse. Reproduced on a61b56f: in the installed workerd runtime, a test checkout reached paid after the switch (`assert.notEqual(state, 'paid')` failed with `paid`).

Repair: each new attempt keeps `paymentMode` from the store when it starts (absent on older attempts, meaning test). Before any Payments session or lookup, Checkout leaves the attempt untouched unless the store is in that same mode, and the Payments port still requires its binding to match the store, so the attempt's mode, the store's mode and the binding's mode all agree before Payments is asked. The order records the attempt's mode, including a zero-payable order. A checkout open during a switch waits, with no lookup and no order, until the store switches back; nothing is released, because only the Payments that saw the payment can say it was not taken.

No rejected findings. The other checklist items in the review (proof, merge risk, next step, patch quality) are this same finding.
