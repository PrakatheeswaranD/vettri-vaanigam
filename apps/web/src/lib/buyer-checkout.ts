import type { PaymentDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "./api-client";
import { loadRazorpayCheckoutScript, openRazorpayCheckout } from "./razorpay-checkout";

/**
 * Opens Razorpay's hosted checkout for a proposal the server already
 * priced, and resolves with the VERIFIED payment — or null if the buyer
 * came back without paying.
 *
 * WHY THIS TAKES AN `onOpen` CALLBACK
 *
 * `modal.ondismiss` is the documented way back when a buyer closes the
 * checkout, and it works. It is not the only way the checkout can end.
 * Razorpay's overlay can fail to become usable at all — an ad blocker, a
 * CSP, or their own bot protection answering 403 — and then it renders a
 * full-screen backdrop with no close control, fires neither callback, and
 * this promise never settles. Observed for real: the page sat under a
 * dimmed overlay with the pay button stuck on "Opening checkout…" and no
 * way out but a reload.
 *
 * So the caller is handed a `cancel` function and can offer the buyer a
 * way out. It is deliberately a HUMAN escape rather than a timer: a timer
 * long enough to be safe is useless, and one short enough to be useful
 * would interrupt somebody midway through paying.
 *
 * Cancelling tears down Razorpay's overlay and resolves null. It asserts
 * NOTHING about the payment — the row keeps whatever state the provider
 * last gave it, and only a verified webhook or a signed completion can
 * change that.
 */
export async function completeBuyerCheckout(
  proposalId: string,
  onOpen?: (cancel: () => void) => void,
): Promise<PaymentDTO | null> {
  const checkout = await apiGet<{ paymentId: string; providerOrderId: string; amountMinor: number; currency: string; keyId: string }>(`/buyer/purchase-proposals/${proposalId}/payment/checkout`);
  await loadRazorpayCheckoutScript();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: PaymentDTO | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const instance = openRazorpayCheckout({
      key: checkout.keyId,
      amount: checkout.amountMinor,
      currency: checkout.currency,
      order_id: checkout.providerOrderId,
      name: "Vettri Vaanigam — Razorpay Test Mode",
      modal: { ondismiss: () => finish(null) },
      handler: (response) => {
        void apiPost<PaymentDTO>(`/buyer/purchase-proposals/${proposalId}/payment/verify`, {
          paymentId: checkout.paymentId,
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        }).then(
          (payment) => {
            if (!settled) {
              settled = true;
              resolve(payment);
            }
          },
          (error) => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          },
        );
      },
    });

    onOpen?.(() => {
      // Ask Razorpay to close first — that is their supported teardown and
      // it also abandons the hosted session cleanly.
      try {
        instance.close();
      } catch {
        /* their teardown is not something we can depend on */
      }
      // And then make sure the page is actually usable again. `close()`
      // does nothing when their frame never initialised, which is exactly
      // the case this escape exists for: observed leaving a full-screen
      // backdrop over the page after the button had already recovered.
      // Removing their own container from our document is a UI teardown
      // and nothing more — it asserts nothing about the payment, which
      // keeps whatever state the provider last gave it.
      document.querySelectorAll(".razorpay-container, .razorpay-backdrop").forEach((node) => node.remove());
      finish(null);
    });

    instance.open();
  });
}
