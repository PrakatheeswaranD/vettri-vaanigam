import type { PaymentDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "./api-client";
import { loadRazorpayCheckoutScript, openRazorpayCheckout } from "./razorpay-checkout";

export async function completeBuyerCheckout(proposalId: string): Promise<PaymentDTO | null> {
  const checkout = await apiGet<{ paymentId: string; providerOrderId: string; amountMinor: number; currency: string; keyId: string }>(`/buyer/purchase-proposals/${proposalId}/payment/checkout`);
  await loadRazorpayCheckoutScript();
  return new Promise((resolve, reject) => {
    const instance = openRazorpayCheckout({ key: checkout.keyId, amount: checkout.amountMinor, currency: checkout.currency, order_id: checkout.providerOrderId, name: "Vaanigam — Razorpay Test Mode", modal: { ondismiss: () => resolve(null) }, handler: (response) => {
      void apiPost<PaymentDTO>(`/buyer/purchase-proposals/${proposalId}/payment/verify`, { paymentId: checkout.paymentId, razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature }).then(resolve, reject);
    } });
    instance.open();
  });
}
