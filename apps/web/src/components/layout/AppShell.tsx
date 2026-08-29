import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { Skeleton } from "../ui/States";

/**
 * App shell.
 *
 * The shell is pinned to the viewport and the CONTENT scrolls inside it,
 * rather than the whole page scrolling as one column.
 *
 * That is not a cosmetic preference. Previously the sidebar stretched to
 * the height of the page — on the decision log it measured 3340px against
 * an 820px viewport — so scrolling to read a decision scrolled the
 * navigation away with it. On the pages a merchant spends longest on, the
 * way out was always off-screen.
 *
 * `min-h-0` on the scrolling column is what actually allows it to shrink
 * inside a flex parent; without it the column reports its content height
 * and nothing ever scrolls internally.
 */
export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-subtle">
      <Sidebar />
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
            <ErrorBoundary>
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
