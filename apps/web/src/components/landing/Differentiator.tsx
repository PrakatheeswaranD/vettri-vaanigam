/**
 * The core claim, and the section the whole page exists to earn.
 *
 * The pipeline is drawn as six stages because the boundary between them
 * is the product: the model's output is a PROPOSAL, and a proposal has to
 * pass validation, policy and authorisation before anything moves. The
 * blocked lane underneath makes the negative claim visible — there is no
 * edge from the model to the money — because that is precisely the thing
 * a reader will otherwise assume is marketing.
 */
import { Bot, FileCheck2, Lock, ScanSearch, Scale, ShieldCheck, CreditCard, ChevronRight } from "lucide-react";
import { Reveal, SectionShell, useCardMotion } from "./system";

const STAGES = [
  {
    key: "agent",
    label: "AI Agent",
    icon: Bot,
    body: "Reads the catalogue, the intent and the history.",
    gate: false,
  },
  {
    key: "proposal",
    label: "Proposal",
    icon: FileCheck2,
    body: "Emits a structured proposal. Never an instruction.",
    gate: false,
  },
  {
    key: "validation",
    label: "Validation",
    icon: ScanSearch,
    body: "Grounded against real catalogue and price data.",
    gate: true,
  },
  {
    key: "policy",
    label: "Policy Engine",
    icon: Scale,
    body: "Deterministic rules. Same input, same verdict, every time.",
    gate: true,
  },
  {
    key: "authorization",
    label: "Authorization",
    icon: ShieldCheck,
    body: "Limits, merchant status and risk cleared before release.",
    gate: true,
  },
  {
    key: "payment",
    label: "Payment",
    icon: CreditCard,
    body: "Executed by the payment layer, in Razorpay test mode.",
    gate: false,
  },
];

export function Differentiator() {
  const pipeline = useCardMotion<HTMLOListElement>();

  return (
    <SectionShell
      id="platform"
      layout="stack"
      eyebrow="The architecture"
      title={
        <>
          AI proposes. <span className="os-gradient-text">Policy decides.</span> Payments execute.
        </>
      }
      lede="Three responsibilities, three different mechanisms, and a hard line between the one that reasons and the one that can move money."
    >

      <ol ref={pipeline} className="grid gap-2 lg:grid-cols-6">
        {STAGES.map((stage, index) => (
          <Reveal as="li" key={stage.key} delay={index * 70} className="h-full">
            <div
              className={`os-card os-card-hover relative flex h-full flex-col rounded-2xl p-5 ${
                stage.gate ? "border-[rgba(139,92,246,0.28)]" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`os-pop grid h-9 w-9 place-items-center rounded-xl border border-[var(--os-line)] ${
                    stage.gate ? "text-[var(--os-violet)]" : "text-[var(--os-dim)]"
                  }`}
                >
                  <stage.icon className="h-4 w-4" aria-hidden />
                </span>
                {stage.gate ? (
                  <span className="os-label flex items-center gap-1 text-[var(--os-violet)]">
                    <Lock className="h-3 w-3" aria-hidden />
                    Gate
                  </span>
                ) : (
                  <span className="os-mono text-[11px] text-[var(--os-faint)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                )}
              </div>
              <p className="mt-4 text-[14px] font-semibold tracking-tight text-[var(--os-text)]">{stage.label}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--os-dim)]">{stage.body}</p>

              {index < STAGES.length - 1 ? (
                <ChevronRight
                  aria-hidden
                  className="absolute -right-[13px] top-1/2 hidden h-4 w-4 -translate-y-1/2 text-[var(--os-line-2)] lg:block"
                />
              ) : null}
            </div>
          </Reveal>
        ))}
      </ol>

      {/* The negative claim, drawn. */}
      <Reveal delay={120} className="mt-8">
        <div className="os-card rounded-2xl p-5 sm:p-7">
          <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <div className="os-label shrink-0 rounded-lg border border-[var(--os-line)] px-3 py-2.5 text-center text-[var(--os-dim)] sm:text-left">
              AI Agent
            </div>

            <div className="relative flex flex-1 items-center justify-center py-3">
              <span
                aria-hidden
                className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg, rgba(248,113,113,0.55) 0 8px, transparent 8px 18px)",
                }}
              />
              <span className="relative z-10 inline-flex items-center gap-2 rounded-full border border-[rgba(248,113,113,0.4)] bg-[rgba(20,8,10,0.9)] px-3.5 py-1.5">
                <Lock className="h-3.5 w-3.5 text-[var(--os-danger)]" aria-hidden />
                <span className="os-label text-[var(--os-danger)]">No direct path</span>
              </span>
            </div>

            <div className="os-label shrink-0 rounded-lg border border-[var(--os-line)] px-3 py-2.5 text-center text-[var(--os-dim)] sm:text-right">
              Payment
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center gap-3 border-t border-[var(--os-line)] pt-6 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="os-display inline-flex items-center gap-2.5 text-[15px] tracking-[0.02em] text-[var(--os-text)]">
              <ShieldCheck className="h-4 w-4 text-[var(--os-success)]" aria-hidden />
              LLM NEVER MOVES MONEY DIRECTLY
            </p>
            <p className="max-w-md text-[12px] leading-relaxed text-[var(--os-dim)]">
              The model's raw proposal is stored beside the enforced outcome, so the boundary is checkable from the
              record rather than taken on trust.
            </p>
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}
