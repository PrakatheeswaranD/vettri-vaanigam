import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { Skeleton } from "../ui/States";

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-surface-subtle">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-7xl flex-1 overflow-x-hidden px-4 py-6 lg:px-8">
          <ErrorBoundary>
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
