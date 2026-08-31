-- A real recorded cost may exceed the current sale price. Preserve that
-- evidence so policy can reject a negative-margin offer instead of making
-- the merchant hide the loss as an unknown cost.
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_costMinor_check";
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_costMinor_check"
  CHECK ("costMinor" IS NULL OR "costMinor" >= 0);

-- Delegated payment authorization may be unbound, but a supplied checkout
-- session reference must resolve while the session exists.
CREATE INDEX "AcpDelegatedPayment_checkoutSessionId_idx"
  ON "AcpDelegatedPayment"("checkoutSessionId");
ALTER TABLE "AcpDelegatedPayment"
  ADD CONSTRAINT "AcpDelegatedPayment_checkoutSessionId_fkey"
  FOREIGN KEY ("checkoutSessionId") REFERENCES "AcpCheckoutSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
