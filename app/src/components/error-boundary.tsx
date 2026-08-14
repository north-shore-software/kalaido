import { Component, type ErrorInfo, type ReactNode } from "react";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import { RecoveryScreen } from "@/features/boot/components/recovery-screen";
import { stageError, type StageError } from "@/hooks/use-app-state.ts";

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  error: StageError | null;
}

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { error: stageError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <RecoveryScreen
        title="Kalaido hit an unexpected error"
        description="Something went wrong while drawing the screen. You can reload, open a different kalaidoscope, or reset the app to start fresh."
        error={this.state.error}
        onRetry={() => reloadAppWindow()}
        retryLabel="Reload Kalaido"
        allowSwitch
        onSwitched={() => this.setState({ error: null })}
      />
    );
  }
}
