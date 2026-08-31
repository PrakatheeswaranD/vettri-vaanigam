-- x402 facilitator settlement is a first-class payment rail. Keeping it as
-- RAZORPAY or MOCK would make financial evidence and reconciliation lie about
-- its source.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'X402';
