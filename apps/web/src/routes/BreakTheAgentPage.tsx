/**
 * Break the Agent (PART 09 §24-§30) — an adversarial sandbox next to
 * Trust Trace. Every preset drives a REAL deterministic gate through the
 * real `/sandbox/break-the-agent/run` endpoint; nothing here is a fake
 * "blocked" animation. TEST/DEMO SANDBOX ONLY (§29) — scoped to the one
 * controlled demo merchant this whole application already operates on.
 */
import { useState } from "react";
import { Swords, ShieldAlert } from "lucide-react";
import { clsx } from "clsx";
import { useSandboxPresets, useRunSandboxAttack } from "../hooks/use-sandbox";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ErrorState, Skeleton } from "../components/ui/States";
import { ApiError } from "../lib/api-client";
import { SANDBOX_STAGE_STATUS_SPEC, ATTACK_CATEGORY_LABEL } from "../features/break-the-agent/sandbox-stage-status";
import type { SandboxAttackId, SandboxRunResultDTO } from "@razorgrowth/contracts";

function ResultTimeline({ result }: { result: SandboxRunResultDTO }) {
  return (
    <div className="mt-4 rounded-md border border-border bg-surface-subtle p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert size={16} className="text-danger" />
        <p className="text-sm font-semibold text-ink">Attack blocked at: {result.stages.find((s) => s.id === result.blockedAtStage)?.label ?? result.blockedAtStage}</p>
      </div>
      <div className="space-y-2">
        {result.stages.map((stage, i) => {
          const spec = SANDBOX_STAGE_STATUS_SPEC[stage.status];
          const Icon = spec.icon;
          const isBlocking = stage.id === result.blockedAtStage;
          return (
            <div key={stage.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", spec.className)}>
                  <Icon size={12} />
                </span>
                {i < result.stages.length - 1 ? <span className="mt-0.5 h-full w-px flex-1 bg-border-strong" /> : null}
              </div>
              <div className={clsx("flex-1 pb-3", isBlocking && "rounded-md bg-danger-subtle/40 px-2 py-1 -mt-1")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{stage.label}</span>
                  <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-medium", spec.className)}>{spec.label}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">{stage.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
        <p className="text-sm text-ink-muted">{result.summary}</p>
        <span className="rounded-full bg-success-subtle px-3 py-1 text-xs font-semibold text-success-text">Money moved: ₹0.00</span>
      </div>
    </div>
  );
}

export default function BreakTheAgentPage() {
  const { data, isLoading, isError, error, refetch } = useSandboxPresets();
  const runAttack = useRunSandboxAttack();
  const [activeAttackId, setActiveAttackId] = useState<SandboxAttackId | null>(null);
  const [results, setResults] = useState<Record<string, SandboxRunResultDTO>>({});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <Swords size={20} className="text-danger" />
          Break the Agent
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          TEST / DEMO SANDBOX — try to make the AI move money, bypass approval, or hallucinate a product. Every attack
          below runs through the real deterministic validation, policy, and eligibility code this application actually
          uses. No fake &quot;blocked&quot; animation, and no real money ever moves.
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardBody>
            <Skeleton className="h-40 w-full" />
          </CardBody>
        </Card>
      ) : isError ? (
        <Card>
          <CardBody>
            <ErrorState message={error instanceof ApiError ? error.message : "Could not load attack presets."} onRetry={() => void refetch()} />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data?.presets.map((preset) => {
            const isActive = activeAttackId === preset.id;
            const result = results[preset.id];
            return (
              <Card key={preset.id} data-tour-id={`break-the-agent-${preset.id}`}>
                <CardHeader className="flex items-start justify-between gap-2">
                  <div>
                    <span className="mb-1 inline-block rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                      {ATTACK_CATEGORY_LABEL[preset.category] ?? preset.category}
                    </span>
                    <CardTitle>&ldquo;{preset.label}&rdquo;</CardTitle>
                    <p className="mt-1 text-xs text-ink-muted">{preset.description}</p>
                  </div>
                </CardHeader>
                <CardBody>
                  <button
                    type="button"
                    disabled={isActive && runAttack.isPending}
                    onClick={() => {
                      setActiveAttackId(preset.id);
                      runAttack.mutate(preset.id, {
                        onSuccess: (data) => setResults((prev) => ({ ...prev, [preset.id]: data })),
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-danger bg-danger-subtle px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger/10 disabled:opacity-60"
                  >
                    <Swords size={14} />
                    {isActive && runAttack.isPending ? "Attacking…" : result ? "Run again" : "Attempt this attack"}
                  </button>
                  {isActive && runAttack.isError ? (
                    <p className="mt-2 text-xs text-danger-text">{runAttack.error instanceof ApiError ? runAttack.error.message : "Attack could not be run."}</p>
                  ) : null}
                  {result ? <ResultTimeline result={result} /> : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
