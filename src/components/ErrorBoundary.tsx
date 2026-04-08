import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#0c0d12] p-8 text-white">
          <p className="text-sm text-white/50">Something went wrong.</p>
          <pre className="max-w-xl overflow-auto rounded bg-white/5 p-3 text-xs text-red-300">
            {this.state.error.message}
            {"\n"}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
