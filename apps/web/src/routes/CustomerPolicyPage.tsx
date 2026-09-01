import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { useBuyerSpendingPolicy, useUpdateBuyerSpendingPolicy } from "../hooks/use-api";
import { ErrorState, Skeleton } from "../components/ui/States";
import { RupeeInput } from "../components/ui/RupeeInput";

/**
 * Words a shopper plausibly types meaning "everything", which the
 * deterministic gate matches LITERALLY — a policy listing `all` permits a
 * category named "all" and nothing else, so every purchase is declined
 * CATEGORY_NOT_ALLOWED with a message that reads like the shopper erred.
 *
 * These are used ONLY to warn. They are never treated as a wildcard:
 * inferring intent from a magic word is what makes a typo and a
 * deliberate "allow everything" indistinguishable to an auditor, and a
 * reserved word inside user-supplied text is what an injection would aim
 * to get written. Permitting everything requires the explicit toggle.
 */
const WILDCARD_LOOKALIKES = new Set(["all", "any", "*", "everything", "anything", "all categories"]);

function looksLikeWildcard(categories: string[]): string | null {
  return categories.find((value) => WILDCARD_LOOKALIKES.has(value.trim().toLowerCase())) ?? null;
}

export default function CustomerPolicyPage() {
  const policy = useBuyerSpendingPolicy();
  const update = useUpdateBuyerSpendingPolicy();
  const [autonomous, setAutonomous] = useState(200000);
  const [daily, setDaily] = useState(1000000);
  const [categories, setCategories] = useState("");
  const [allowAll, setAllowAll] = useState(false);

  useEffect(() => {
    if (!policy.data) return;
    setAutonomous(policy.data.autonomousPurchaseLimitMinor);
    setDaily(policy.data.dailyLimitMinor);
    setCategories(policy.data.allowedCategories.join(", "));
    setAllowAll(policy.data.allowAllCategories);
  }, [policy.data]);

  if (policy.isLoading) return <Skeleton className="h-80" />;
  if (policy.isError) return <ErrorState message="Could not load your spending policy." onRetry={() => policy.refetch()} />;

  const parsedCategories = categories.split(",").map((value) => value.trim()).filter(Boolean);
  const wildcardWord = allowAll ? null : looksLikeWildcard(parsedCategories);
  const noCategories = !allowAll && parsedCategories.length === 0;
  // "Saved" used to stay on screen while the form was edited underneath
  // it, so a changed-but-unsaved policy read as saved — the one thing this
  // screen must never get wrong. It is now shown only while what is on
  // screen is what is stored.
  const saved = policy.data
    ? autonomous === policy.data.autonomousPurchaseLimitMinor
      && daily === policy.data.dailyLimitMinor
      && allowAll === policy.data.allowAllCategories
      && categories === policy.data.allowedCategories.join(", ")
    : false;
  const dailyBelowAutonomous = daily < autonomous;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Customer controls</p>
        <h1 className="mt-1 text-2xl font-bold">Buyer Agent spending policy</h1>
        <p className="mt-2 text-sm text-ink-muted">Bound what the agent may purchase autonomously. Purchases above the threshold require your explicit approval.</p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            autonomousPurchaseLimitMinor: autonomous,
            dailyLimitMinor: daily,
            allowedCategories: parsedCategories,
            allowAllCategories: allowAll,
            approvalRequiredAboveLimit: true,
          });
        }}
        className="space-y-5 rounded-card border border-border bg-surface p-6"
      >
        <RupeeInput label="Single purchase the agent may make on its own" valueMinor={autonomous} onChangeMinor={setAutonomous} help="Above this, the agent has to ask you to authorize the exact amount." />
        <RupeeInput label="Total the agent may spend in a day" valueMinor={daily} onChangeMinor={setDaily} help="Counts pending purchases as well as completed ones." />

        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={allowAll}
              onChange={(event) => setAllowAll(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-brand-600"
            />
            <span>
              <span className="text-sm font-semibold">Allow every category</span>
              <span className="mt-0.5 block text-xs text-ink-faint">
                The category check is skipped entirely. Your spending limits still apply, and purchases above the autonomous limit still need your approval.
              </span>
            </span>
          </label>

          <label className="block">
            <span className={`text-sm font-semibold ${allowAll ? "text-ink-faint" : ""}`}>Allowed categories</span>
            <input
              value={categories}
              onChange={(event) => setCategories(event.target.value)}
              disabled={allowAll}
              placeholder={allowAll ? "Every category is allowed" : "Running Shoes, Accessories"}
              className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-surface-subtle disabled:text-ink-faint"
            />
            <span className="mt-1 block text-xs text-ink-faint">Comma-separated, matched deterministically and case-sensitively.</span>
          </label>
        </div>

        {wildcardWord ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning-text">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <span>
              “{wildcardWord}” is matched literally, as a category with that exact name — it does <strong>not</strong> mean “everything”.
              Saved as-is, every purchase would be declined. Tick <strong>Allow every category</strong> above if that is what you meant.
            </span>
          </div>
        ) : null}

        {noCategories ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning-text">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            An empty list permits nothing, so every purchase will be declined. Add a category or tick “Allow every category”.
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-md bg-brand-50 p-3 text-sm text-brand-700">
          <ShieldCheck size={17} className="mt-0.5 shrink-0" />
          Above the autonomous limit, the Buyer Agent must ask you to authorize the exact amount.
        </div>

        {dailyBelowAutonomous ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning-text">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            Your daily limit is below your single-purchase limit, so the single-purchase limit could never be reached. Raise the daily limit to save.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button disabled={update.isPending || dailyBelowAutonomous} className="rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
            {update.isPending ? "Saving…" : "Save spending policy"}
          </button>
          {update.isSuccess && saved ? <span role="status" className="inline-flex items-center gap-1 text-sm text-success-text"><CheckCircle2 size={14} /> Saved</span> : null}
          {update.isError ? <span role="alert" className="text-sm text-danger-text">Could not save. Check the values and try again.</span> : null}
        </div>
      </form>
    </div>
  );
}
