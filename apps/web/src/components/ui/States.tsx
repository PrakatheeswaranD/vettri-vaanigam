/**
 * Loading / empty / error state primitives (PART 01 §50, §72). Every data
 * surface uses these instead of ad hoc "if (loading) return null" logic,
 * and a failed request always renders one of these — never silently
 * substituted fake data.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { clsx } from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded bg-surface-sunken", className)} />;
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-sunken text-ink-faint">
        {icon ?? <Inbox size={18} />}
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-subtle text-danger">
        <AlertTriangle size={18} />
      </div>
      <p className="text-sm font-medium text-ink">Something went wrong</p>
      <p className="max-w-sm text-sm text-ink-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle"
        >
          <RotateCw size={14} /> Retry
        </button>
      ) : null}
    </div>
  );
}
