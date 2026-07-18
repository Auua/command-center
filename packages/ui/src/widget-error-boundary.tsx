'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  widgetTitle: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Per-widget error boundary (ADR §4.2): a broken widget renders a fallback
 * card, never a blank dashboard.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" className="cc-widget-error">
          <strong>{this.props.widgetTitle}</strong> couldn’t load.
        </div>
      );
    }
    return this.props.children;
  }
}
