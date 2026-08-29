/**
 * Business events that trigger the specialist (Part 11 §24-§27).
 *
 * Reads the single shared `SPECIALIST_TRIGGERS` declaration from the
 * domain package, so this panel, the Agent Authority table, and the docs
 * can never drift apart. Anumati is not a chat-only system — these
 * are the real commerce events that cause it to do work.
 */
import { ArrowRight, MessageSquare, MousePointerClick, XCircle } from "lucide-react";
import { SPECIALIST_TRIGGERS } from "@razorgrowth/domain";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";

const TRIGGER_ICON: Record<string, typeof MessageSquare> = {
  "buyer.intent.created": MessageSquare,
  "product.selected": MousePointerClick,
  "payment.failed": XCircle,
};

export function BusinessTriggers() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business Triggers</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-ink-faint">
          The commerce events that cause this merchant’s own agents to do work. Each one enters the same governed path —
          reasoning produces a proposal, deterministic systems decide whether it may proceed.
        </p>
        {SPECIALIST_TRIGGERS.map((trigger) => {
          const Icon = TRIGGER_ICON[trigger.id] ?? MessageSquare;
          return (
            <div key={trigger.id} className="rounded-card bg-surface-subtle px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Icon size={14} className="shrink-0 text-brand-600" />
                <span className="text-sm font-medium text-ink">{trigger.label}</span>
                <code className="ml-auto shrink-0 font-mono text-[10px] text-ink-faint">{trigger.id}</code>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{trigger.description}</p>
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-faint">
                <ArrowRight size={10} className="shrink-0" />
                {trigger.entryPoint}
              </p>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
