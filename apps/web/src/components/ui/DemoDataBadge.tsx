/**
 * PART 01 §76, §77 — a subtle, consistent marker for seeded/synthetic
 * rows so they can never be mistaken for real Razorpay activity.
 */
import { FlaskConical } from "lucide-react";

export function DemoDataBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-2 py-0.5 text-[11px] font-medium text-info-text">
      <FlaskConical size={11} />
      Demo data
    </span>
  );
}
