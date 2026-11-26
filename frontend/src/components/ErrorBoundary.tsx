import { Component } from 'react';
import type { ReactNode } from 'react';
import { ErrorPanel } from './ErrorPanel';

interface State {
    failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    render(): ReactNode {
        if (this.state.failed) {
            return <ErrorPanel onRetry={() => this.setState({ failed: false })} />;
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
