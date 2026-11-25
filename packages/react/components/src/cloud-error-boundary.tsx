import { type StageError, stageError } from "@kalaido/client/lib/errors";
import { getHost } from "@kalaido/platform";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { RecoveryView } from "./recovery-view";

export interface CloudErrorBoundaryProps {
  children: ReactNode;
  onBeforeClear: () => Promise<void>;
}

export class CloudErrorBoundary extends Component<
  CloudErrorBoundaryProps,
  { error: StageError | null }
> {
  state: { error: StageError | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: stageError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <RecoveryView
        title="Kalaido hit an unexpected error"
        description="Something went wrong while drawing the screen. You can reload or reset settings to start fresh."
        error={this.state.error}
        onRetry={() => getHost().reload()}
        retryLabel="Reload Kalaido"
        onBeforeClear={this.props.onBeforeClear}
      />
    );
  }
}
