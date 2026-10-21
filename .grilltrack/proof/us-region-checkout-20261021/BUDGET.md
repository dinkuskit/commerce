# Approved Registry budget exception for US delivery validation

On 21 October 2026, the owner answered the specific Commerce #161 budget question:

> Allow 1,518 bytes for this feature

This allows the approved US physical-delivery region feature to consume 682 bytes of the otherwise reserved 2,200 bytes. The measured official backend is 129,554 bytes under the unchanged 131,072-byte Registry cap, leaving 1,518 bytes. Its SHA256 is `64c60e258da4e22b3bdedd30991e60cff09a1c4c8d8781d98b39aeab31a39260`.

The exception applies only to `us-physical-delivery-regions-20261021` and this measured feature. The general 2,200-byte reserve in `registry-coupons-parked-20261021` remains the default; this is not a blanket lower budget for future growth. Coupon wiring and Inventory remain parked. A future coupon integration must remeasure the available space and reconcile its budget.

The decision changes no product code, security check, build transform, dependency or package-size cap. Source/build inputs and the artifact remain unchanged from the verified feature. Record the exception as a dependent GrillTrack decision rather than replacing or deleting the general reserve decision.

This is the owner disposition requested by the first comprehensive review. It resolves that budget finding only. Current-head CI and both required reviews remain independent gates. Merge, deployment and package publication are not authorized by this budget decision.
