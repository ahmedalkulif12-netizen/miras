import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BootstrapErrorScreen } from '@/components/AppBootScreens';

type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null };

type ComponentInstance = {
  props: BoundaryProps;
  state: BoundaryState;
  setState: (state: BoundaryState) => void;
};

/**
 * Last-resort UI when a React render throws — native TestFlight otherwise stays white.
 */
export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    (this as unknown as ComponentInstance).state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] React render crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    const self = this as unknown as ComponentInstance;
    const state = self.state ?? { error: null };
    if (state.error) {
      return <BootstrapErrorScreen error={state.error} />;
    }
    return self.props.children;
  }
}
