/**
 * What this agent is able to do, as the server declares it.
 *
 * WHY THIS IS WORTH A PANEL
 *
 * The agent's capabilities used to exist only as branches inside the
 * autonomous cycle. Nothing could answer "what can it do?" — not the
 * console, not a merchant, not a test. A merchant was asked to switch on
 * unattended runs without any way to see what unattended runs would
 * actually be permitted to do.
 *
 * Every word below comes from the server's tool registry: the summary, the
 * safety class, whether it moves money, whether it stops for approval. The
 * console does not describe the agent in its own words, because a
 * description maintained separately from the thing it describes drifts
 * from it.
 */
import { Coins, ShieldCheck, Wrench } from "lucide-react";
import { useAgentTools } from "../../hooks/use-commerce";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Skeleton } from "../ui/States";

const READS_LABEL: Record<string, string> = {
  PRODUCTS: "Products",
  CUSTOMERS: "Customers",
  ORDERS: "Orders",
  PAYMENTS: "Payments",
};

export function AgentToolbox() {
  const tools = useAgentTools();

  if (tools.isPending) return <Skeleton className="h-40" />;
  // A panel that cannot load is not worth an error state of its own — the
  // page around it still works, and the run controls are what matter.
  if (tools.isError || !tools.data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What it can do</CardTitle>
      </CardHeader>
      <CardBody className="divide-y divide-border-hair">
        {tools.data.tools.map((tool) => (
          <div key={tool.name} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Wrench size={13} className="shrink-0 text-ink-faint" aria-hidden />
              <span className="text-sm font-semibold text-ink">{tool.name.replaceAll("_", " ")}</span>
              <span
                className={
                  tool.safety === "AUTOMATIC"
                    ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                }
              >
                {tool.safety === "AUTOMATIC" ? "Runs on its own" : "Governed"}
              </span>
              <span className="text-xs text-ink-faint">reads {READS_LABEL[tool.reads] ?? tool.reads}</span>
            </div>
            <p className="mt-1 text-xs leading-snug text-ink-muted">{tool.summary}</p>
            <p className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-ink-faint">
              {tool.movesMoney ? (
                <Coins size={11} className="mt-0.5 shrink-0" aria-hidden />
              ) : (
                <ShieldCheck size={11} className="mt-0.5 shrink-0" aria-hidden />
              )}
              <span>
                {tool.movesMoney ? "Can put money in motion." : "Moves no money."}
                {tool.requiresApproval
                  ? " Stops for your approval outside your automatic limits."
                  : " Needs no approval."}
              </span>
            </p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
