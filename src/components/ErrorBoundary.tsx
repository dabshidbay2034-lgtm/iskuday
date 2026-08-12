import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/analytics";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere below it.
 *
 * Without this, a single thrown error unmounts the whole React tree and the
 * visitor is left staring at a blank white page with no hint that anything went
 * wrong — the failure mode React itself warns about in the console. Pages here
 * are lazy-loaded and data-driven, so one unexpected null from Supabase used to
 * be enough to blank the app.
 *
 * Deliberately a class: `getDerivedStateFromError` / `componentDidCatch` have no
 * hook equivalent.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] uncaught render error", error, info.componentStack);

    // Reported by hand because catching the error here is exactly what stops it
    // reaching window.onerror, where PostHog's `capture_exceptions` listens.
    // Without this line a crash is visible only in the user's own console.
    captureException(error, {
      componentStack: info.componentStack,
      path: window.location.pathname,
    });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-md">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>
          <h1 className="font-heading font-bold text-xl text-foreground mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            This page hit an unexpected error. Reloading usually clears it — if it
            keeps happening, please let us know.
          </p>

          {/* The message is useful in development and harmless in production
              (it is the same string already visible in the console), but the
              stack stays out of the UI. */}
          {import.meta.env.DEV && (
            <pre className="text-left text-[11px] text-muted-foreground bg-muted rounded-xl p-3 mb-6 overflow-x-auto">
              {error.message}
            </pre>
          )}

          <div className="flex gap-2 justify-center">
            <Button variant="hero" onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button variant="outline" onClick={() => { window.location.href = "/"; }}>
              Go home
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
