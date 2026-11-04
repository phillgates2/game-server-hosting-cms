"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error(`[ErrorBoundary ${this.props.name || "unknown"}]`, error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      // The exception text is useful while developing and can leak internals
      // from a live panel, so production shows only the fact that it failed.
      const showDetail = process.env.NODE_ENV !== "production";
      return (
        <div className="bg-bg-card border border-danger/30 rounded-xl p-8 text-center" role="alert">
          <span className="text-3xl block mb-2">⚠️</span>
          <h3 className="font-semibold text-danger mb-1">Something went wrong</h3>
          <p className="text-text-muted text-sm mb-3">
            {this.props.name
              ? `The ${this.props.name} panel hit an error. Everything else is still running.`
              : "An error occurred. Everything else is still running."}
          </p>
          {showDetail && (
            <p className="text-xs text-text-muted bg-bg-secondary rounded p-2 font-mono break-all max-w-xl mx-auto">
              {this.state.error?.message || "Unknown error"}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-bg-tertiary border border-border text-text-secondary hover:bg-bg-hover rounded-lg text-sm"
            >
              Reload the panel
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
