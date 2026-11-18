import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

/** Keeps one failing page from blanking the whole app; resets when the route changes. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-column gap-3 align-items-start">
        <Message severity="error" text={`This page hit an error: ${this.state.error.message}`} />
        <Button label="Try again" icon="pi pi-refresh" outlined onClick={() => this.setState({ error: null })} />
      </div>
    );
  }
}
