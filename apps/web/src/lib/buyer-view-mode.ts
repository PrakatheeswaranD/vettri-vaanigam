import { useCallback, useEffect, useState } from "react";

/**
 * Which face of the Buyer Agent is showing.
 *
 * "buyer" is a shopping assistant: bubbles, a narrated sentence, products.
 * "trace" is the audit view: the full reasoning pipeline, provider mode,
 * candidate counts and the raw server response.
 *
 * One screen genuinely cannot serve both. A shopper does not want to be
 * told "3 candidates considered · Live Gemini model" before seeing a shoe,
 * and a judge checking that the pipeline is real is not served by a chat
 * bubble. Splitting them is the honest answer; hiding the trace would throw
 * away the strongest evidence this project has.
 */
export type BuyerViewMode = "buyer" | "trace";

const STORAGE_KEY = "vettri_vaanigam.buyerViewMode";

function readStored(): BuyerViewMode {
  try {
    // Preserve the existing preference when moving to the new brand key.
    const saved = sessionStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem("vaanigam.buyerViewMode");
    if (saved !== null) {
      sessionStorage.setItem(STORAGE_KEY, saved);
      sessionStorage.removeItem("vaanigam.buyerViewMode");
    }
    return saved === "trace" ? "trace" : "buyer";
  } catch {
    // Private windows and blocked site data throw on access. Defaulting to
    // the shopper view is right: it is the one a first-time visitor wants.
    return "buyer";
  }
}

export function useBuyerViewMode(): [BuyerViewMode, (next: BuyerViewMode) => void] {
  const [mode, setMode] = useState<BuyerViewMode>("buyer");

  // Read after mount so server and first client render agree.
  useEffect(() => {
    setMode(readStored());
  }, []);

  const update = useCallback((next: BuyerViewMode) => {
    setMode(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Losing the preference is survivable; failing the click is not.
    }
  }, []);

  return [mode, update];
}
