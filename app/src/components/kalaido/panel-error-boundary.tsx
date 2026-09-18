import { Component, type ErrorInfo, Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { toError } from "@/lib/errors";
import { EmptyState } from "./empty-state";

interface PanelErrorBoundaryProps {
  /** What the panel is, in the fallback's sentence: "the chat", "this preview". */
  label: string;
  /**
   * When this changes the boundary forgets its error and remounts its
   * children — key it on whatever the panel is showing (a chat id, a
   * snapshot id) so moving on from the broken thing clears the fallback.
   */
  resetKey?: unknown;
  onReset?: () => void;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  error: Error | null;
  /** Bumped on reset so the children remount rather than resume mid-error. */
  generation: number;
}

/**
 * Fault isolation for one panel. A render error inside a chat, a markdown
 * preview or a diff ends here, as a small "try again" card in the panel's own
 * space — the sidebar, title bar and the other panels keep working. Shell
 * errors still fall through to `RootErrorBoundary`.
 */
export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null, generation: 0 };

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<PanelErrorBoundaryState> {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `Render error in ${this.props.label}:`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(prev: PanelErrorBoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = () => {
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <PanelErrorFallback
          label={this.props.label}
          message={this.state.error.message}
          onRetry={this.reset}
        />
      );
    }
    return (
      <Fragment key={this.state.generation}>{this.props.children}</Fragment>
    );
  }
}

/** The card a broken panel shows in its own space. */
export function PanelErrorFallback({
  label,
  message,
  onRetry,
}: {
  label: string;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      centered
      className="p-6"
      action={
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      Something went wrong drawing {label}.
      {message && <span className="block text-fg-3">{message}</span>}
    </EmptyState>
  );
}
