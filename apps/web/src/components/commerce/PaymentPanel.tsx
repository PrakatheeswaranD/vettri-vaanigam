/**
 * PART 07 §66-§70, §108-§110, §164-§172 — the real Razorpay Test Mode
 * payment experience. The browser only ever: (1) asks the server to
 * initiate a payment for a checkout ID, (2) opens Razorpay's own
 * Checkout widget with the server-issued provider order, and (3) forwards
 * whatever Razorpay's callback returns to the server for verification.
 * It never decides success/failure itself — every state shown here comes
 * from `GET /payments/:id`, polled until a terminal state is reached
 * (PART 07 §41, §169).
 */
import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { formatMoney } from "../../lib/format";
import { ApiError } from "../../lib/api-client";
import { loadRazorpayCheckoutScript, openRazorpayCheckout } from "../../lib/razorpay-checkout";
import { isTerminalPaymentState, useInitiatePayment, usePayment, useVerifyPaymentCompletion } from "../../hooks/use-payments";
import { RecoveryPanel } from "./RecoveryPanel";

const FAILURE_CATEGORY_TEXT: Record<string, string> = {
  PAYMENT_DECLINED: "The payment was declined by the bank/issuer.",
  INSUFFICIENT_FUNDS: "The payment method had insufficient funds.",
  AUTHENTICATION_FAILED: "Payment authentication (OTP/3-D Secure) failed.",
  NETWORK_ERROR: "A network error interrupted the payment.",
  PROVIDER_ERROR: "Razorpay reported a provider-side error.",
  TIMEOUT_UNKNOWN: "The payment timed out before a final state was confirmed.",
  CUSTOMER_CANCELLED: "The payment was cancelled before completion.",
  UNKNOWN_FAILURE: "The payment failed for an unspecified reason.",
};

type LocalPhase = "IDLE" | "INITIATING" | "AWAITING_COMPLETION" | "VERIFYING" | "ERROR";

export function PaymentPanel({ checkoutId }: { checkoutId: string }) {
  const [phase, setPhase] = useState<LocalPhase>("IDLE");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const initiate = useInitiatePayment();
  const verify = useVerifyPaymentCompletion();
  const payment = usePayment(paymentId, { poll: phase === "VERIFYING" || phase === "AWAITING_COMPLETION" });

  useEffect(() => {
    if (payment.data && isTerminalPaymentState(payment.data.state)) {
      setPhase("IDLE");
    }
  }, [payment.data]);

  async function handlePay() {
    setErrorMessage(null);
    setPhase("INITIATING");
    try {
      await loadRazorpayCheckoutScript();
      const initiation = await initiate.mutateAsync(checkoutId);
      setPaymentId(initiation.paymentId);
      setPhase("AWAITING_COMPLETION");

      const instance = openRazorpayCheckout({
        key: initiation.keyId,
        amount: initiation.amountMinor,
        currency: initiation.currency,
        order_id: initiation.providerOrderId,
        name: "Vaanigam — Test Mode",
        description: `Checkout ${initiation.checkoutId.slice(0, 8)}`,
        theme: { color: "#4f46e5" },
        handler: (response) => {
          setPhase("VERIFYING");
          verify.mutate(
            {
              paymentId: initiation.paymentId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            },
            {
              onError: (err) => {
                setPhase("ERROR");
                setErrorMessage(err instanceof ApiError ? err.message : "Payment verification failed.");
              },
            },
          );
        },
        modal: {
          ondismiss: () => {
            setPhase("IDLE");
          },
        },
      });
      instance.open();
    } catch (err) {
      setPhase("ERROR");
      setErrorMessage(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not start payment.");
    }
  }

  const state = payment.data?.state;

  if (state === "CAPTURED") {
    return (
      <Card className="border-success/40">
        <CardHeader className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-success" />
          <CardTitle>Payment captured</CardTitle>
          <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning-text">TEST MODE</span>
        </CardHeader>
        <CardBody className="space-y-1 text-sm">
          <p className="text-ink">
            Order paid — <span className="font-medium">{formatMoney({ amountMinor: payment.data!.amountMinor, currency: payment.data!.currency })}</span> (Observed).
          </p>
          <p className="text-xs text-ink-faint">Provider payment reference: {payment.data!.providerPaymentId?.slice(0, 18)}…</p>
        </CardBody>
      </Card>
    );
  }

  if (state === "FAILED") {
    return (
      <div className="space-y-3">
        <Card className="border-danger/40">
          <CardHeader className="flex items-center gap-2">
            <Ban size={16} className="text-danger" />
            <CardTitle>Payment failed</CardTitle>
            <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning-text">TEST MODE</span>
          </CardHeader>
          <CardBody className="space-y-1 text-sm">
            <p className="text-ink">{FAILURE_CATEGORY_TEXT[payment.data!.failureCategory ?? ""] ?? "The payment did not succeed."}</p>
            <p className="text-xs text-ink-faint">
              No amount was captured. Attempt {payment.data!.attemptNumber}
              {payment.data!.recoveredFromAttemptId ? " (a recovery retry)" : ""}.
            </p>
          </CardBody>
        </Card>
        <RecoveryPanel paymentId={payment.data!.id} />
      </div>
    );
  }

  if (state === "UNKNOWN" || (paymentId && phase === "VERIFYING" && !state)) {
    return (
      <Card className="border-info/40">
        <CardHeader className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-info" />
          <CardTitle>Payment confirmation pending</CardTitle>
        </CardHeader>
        <CardBody className="text-sm text-ink-muted">We&apos;re checking the payment provider for the final state. This page updates automatically.</CardBody>
      </Card>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-card border border-dashed border-border px-4 py-3">
      <div>
        <p className="text-sm font-medium text-ink">Ready for payment</p>
        <p className="text-xs text-ink-muted">
          {phase === "INITIATING" ? "Preparing Razorpay Test Mode checkout…" : phase === "AWAITING_COMPLETION" ? "Complete the payment in the Razorpay window…" : phase === "VERIFYING" ? "Verifying payment securely…" : "Razorpay Test Mode — no real money is processed."}
        </p>
        {errorMessage ? <p className="mt-1 text-xs text-danger-text">{errorMessage}</p> : null}
      </div>
      <button
        type="button"
        disabled={phase === "INITIATING" || phase === "AWAITING_COMPLETION" || phase === "VERIFYING"}
        onClick={handlePay}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === "INITIATING" || phase === "AWAITING_COMPLETION" || phase === "VERIFYING" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
        Pay securely — TEST MODE
      </button>
    </div>
  );
}
