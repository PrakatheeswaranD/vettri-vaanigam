import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-ink-faint">
        <Compass size={22} />
      </div>
      <p className="text-base font-semibold text-ink">Page not found</p>
      <p className="max-w-sm text-sm text-ink-muted">The page you're looking for doesn't exist.</p>
      <Link
        to="/overview"
        className="mt-2 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
      >
        Back to Overview
      </Link>
    </div>
  );
}
