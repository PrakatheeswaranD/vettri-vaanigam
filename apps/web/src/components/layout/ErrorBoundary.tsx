import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** PART 01 §38 — a global error boundary so a rendering bug in one route
 * shows a real failure state instead of a blank white screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
            <AlertTriangle size={22} />
          </div>
          <p className="text-base font-semibold text-ink">Something went wrong rendering this page</p>
          <p className="max-w-md text-sm text-ink-muted">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
