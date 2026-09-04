/**
 * Loads Razorpay's own browser Checkout script exactly once (PART 07
 * §66, §165) — never re-injected on repeated opens. The provider order
 * (`providerOrderId`), the public `keyId`, and the amount/currency this
 * function is handed all come from the server's `/payments/initiate`
 * response; nothing here lets the browser define what gets charged
 * (PART 07 §66).
 */

const CHECKOUT_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  theme?: { color?: string };
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayCheckoutInstance {
  open(): void;
  /** Tears down Razorpay's own overlay. Needed because their checkout can
   * fail to render — an ad blocker, a CSP, or their bot protection
   * returning 403 — leaving a full-screen backdrop with no close control
   * and no `ondismiss`. Closing it is a UI teardown only: it abandons the
   * hosted session and never asserts anything about payment state. */
  close(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

let loadPromise: Promise<void> | null = null;

export function loadRazorpayCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Could not load the Razorpay Checkout script."));
    };
    document.body.appendChild(script);
  });
  return loadPromise;
}

export function openRazorpayCheckout(options: RazorpayCheckoutOptions): RazorpayCheckoutInstance {
  if (!window.Razorpay) throw new Error("Razorpay Checkout script has not finished loading.");
  return new window.Razorpay(options);
}
