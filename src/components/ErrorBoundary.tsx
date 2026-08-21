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
      return (
        <div className="bg-bg-card border border-danger/30 rounded-xl p-8 text-center">
          <span className="text-3xl block mb-2">⚠️</span>
          <h3 className="font-semibold text-danger mb-1">Something went wrong</h3>
          <p className="text-text-muted text-sm mb-3">
            {this.props.name ? `Error in ${this.props.name} panel` : "An error occurred"}
          </p>
          <p className="text-xs text-text-muted bg-bg-secondary rounded p-2 font-mono break-all max-w-xl mx-auto">
            {this.state.error?.message || "Unknown error"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
