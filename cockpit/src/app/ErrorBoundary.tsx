import React, { Component, type ReactNode } from "react";

export type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
};

type ErrorBoundaryState = {
  readonly hasError: boolean;
};

const defaultFallback = (
  <div className="cockpit-view-error" role="alert">
    <strong>Tuto část Cockpitu se nepodařilo zobrazit.</strong>
    <p>Zkuste stránku obnovit. Ostatní části Cockpitu zůstávají dostupné.</p>
  </div>
);

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  readonly state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback ?? defaultFallback;
    return this.props.children;
  }
}
