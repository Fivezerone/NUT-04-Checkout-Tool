import React from "react";

interface ChartBoundaryProps {
  label: string;
  children: React.ReactNode;
}

interface ChartBoundaryState {
  err: boolean;
}

/**
 * D-25: Error boundary for chart components.
 * A single chart render exception previously blanked the whole dashboard.
 * Now each chart section degrades gracefully with a recovery message.
 */
export class ChartBoundary extends React.Component<ChartBoundaryProps, ChartBoundaryState> {
  state: ChartBoundaryState = { err: false };

  static getDerivedStateFromError(): ChartBoundaryState {
    return { err: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[NutriScore] ChartBoundary caught error in "${this.props.label}":`, error, info);
  }

  render() {
    if (this.state.err) {
      return (
        <div
          role="alert"
          className="flex items-center justify-center p-4 text-sm text-muted-foreground rounded-lg border border-muted"
          style={{ minHeight: 80 }}
        >
          Couldn't draw {this.props.label}. Your data is safe — reload to retry.
        </div>
      );
    }
    return this.props.children;
  }
}
