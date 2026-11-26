import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;
const Bomb = () => {
    if (shouldThrow) throw new Error('row 3: alice@example.com');
    return <p>all good</p>;
};

beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
    it('shows a friendly panel without the error text', () => {
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('alice@example.com');
    });

    it('recovers via "Try again" once the cause is gone', () => {
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );
        shouldThrow = false;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(screen.getByText('all good')).toBeInTheDocument();
    });

    it('renders children untouched when nothing fails', () => {
        shouldThrow = false;
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );
        expect(screen.getByText('all good')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
