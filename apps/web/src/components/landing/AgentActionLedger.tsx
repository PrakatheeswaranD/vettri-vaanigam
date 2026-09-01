/**
 * The ledger.
 *
 * Five seconds of one transaction, one row per actor. Each row is a real
 * button: selecting it opens the reason the actor gave and the status the
 * system recorded, which is the difference between a log and an audit
 * trail. Keyboard users get the same thing in the same order — the rows
 * are focusable controls, not decorated list items with click handlers.
 */
import { useState } from "react";
import { Bot, CreditCard, FileLock2, Scale, Store } from "lucide-react";
import { Reveal, SectionShell } from "./system";

const EVENTS = [
  {
    time: "10:42:18",
    actor: "Buyer Agent",
    icon: Bot,
    action: "Intent identified",
    reason: "Natural-language request parsed into four hard constraints, including a ₹80,000 ceiling.",
    status: "Recorded",
    tone: "neutral" as const,
  },
  {
    time: "10:42:19",
    actor: "Merchant Agent",
    icon: Store,
    action: "Product selected",
    reason: "Lowest total cost of ownership among options meeting every constraint, warranty included.",
    status: "Proposed",
    tone: "neutral" as const,
  },
  {
    time: "10:42:20",
    actor: "Policy Engine",
    icon: Scale,
    action: "Purchase approved",
    reason: "₹74,999 sits under the ₹1,00,000 user limit, merchant is verified, and risk scored low.",
    status: "Approved",
    tone: "success" as const,
  },
  {
    time: "10:42:21",
    actor: "Payment",
    icon: CreditCard,
    action: "₹74,999 authorized",
    reason: "Authorization requested only after the policy verdict was written, never before it.",
    status: "Authorized",
    tone: "success" as const,
  },
  {
    time: "10:42:22",
    actor: "Audit",
    icon: FileLock2,
    action: "Action recorded",
    reason: "Entry hash-chained to the previous record, so a later edit would break the chain.",
    status: "Sealed",
    tone: "success" as const,
  },
];

export function AgentActionLedger() {
  const [selected, setSelected] = useState(2);

  return (
    <SectionShell
      id="ledger"
      layout="split"
      eyebrow="Agent action ledger"
      title="Every AI decision leaves a trail."
      lede="Timestamp, actor, action, reason, status. Select any event to read what the system recorded at that moment."
    >

      <Reveal>
        <div className="os-card overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-line)] px-5 py-3.5">
            <p className="os-label text-[var(--os-faint)]">Transaction txn_8f21c4 · 5 events</p>
            <p className="os-mono text-[11px] text-[var(--os-faint)]">chain verified</p>
          </div>

          <ol className="divide-y divide-[var(--os-line)]">
            {EVENTS.map((event, index) => {
              const open = selected === index;
              return (
                <li key={event.time}>
                  <button
                    type="button"
                    onClick={() => setSelected(index)}
                    aria-expanded={open}
                    className={`flex w-full items-start gap-4 px-5 py-4 text-left transition ${
                      open ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className="os-mono w-[68px] shrink-0 pt-0.5 text-[12px] text-[var(--os-faint)]">
                      {event.time}
                    </span>

                    {/* The rail: a dot per event, joined by the row divider
                        above and below. */}
                    <span className="relative flex shrink-0 flex-col items-center self-stretch">
                      <span
                        className="grid h-7 w-7 place-items-center rounded-lg border"
                        style={{
                          borderColor: open ? "rgba(34,211,238,0.45)" : "var(--os-line)",
                          color: event.tone === "success" ? "var(--os-success)" : "var(--os-dim)",
                        }}
                      >
                        <event.icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="os-label text-[var(--os-dim)]">{event.actor}</span>
                        <span className="text-[14px] font-medium text-[var(--os-text)]">{event.action}</span>
                      </span>
                      {open ? (
                        <span className="mt-2 block text-[12.5px] leading-relaxed text-[var(--os-dim)]">
                          {event.reason}
                        </span>
                      ) : null}
                    </span>

                    <span
                      className={`os-label shrink-0 rounded-md border px-2 py-1 ${
                        event.tone === "success"
                          ? "border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.08)] text-[var(--os-success)]"
                          : "border-[var(--os-line)] text-[var(--os-faint)]"
                      }`}
                    >
                      {event.status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </Reveal>
    </SectionShell>
  );
}
