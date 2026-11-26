import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Explain from './Explain';
import ExplainToggle from './ExplainToggle';
import { EXPLAIN_STORAGE_KEY, useExplainStore } from '../store/explainStore';
import { POLICY_EXPLANATIONS } from '../lib/explanations';

beforeEach(() => {
    localStorage.clear();
    useExplainStore.setState({ enabled: true });
});
afterEach(() => localStorage.clear());

const mask = () => (
    <Explain k="policy:mask">
        <button type="button">Mask</button>
    </Explain>
);

describe('Explain', () => {
    it('shows on hover with role=tooltip and links it with aria-describedby', () => {
        render(mask());
        const btn = screen.getByRole('button', { name: 'Mask' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.pointerEnter(btn);
        const tip = screen.getByRole('tooltip');
        expect(tip).toHaveTextContent(POLICY_EXPLANATIONS.mask);
        expect(btn.getAttribute('aria-describedby')).toContain(tip.id);
        expect(btn).toHaveAttribute('data-explain', 'policy:mask');
    });

    it('shows on keyboard focus and hides on blur', () => {
        render(mask());
        const btn = screen.getByRole('button', { name: 'Mask' });
        act(() => btn.focus());
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        act(() => btn.blur());
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('is dismissed by Escape without moving focus (WCAG 1.4.13)', () => {
        render(mask());
        const btn = screen.getByRole('button', { name: 'Mask' });
        act(() => btn.focus());
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(btn).toHaveFocus();
    });

    it('stays while the pointer moves onto the tooltip, and goes after it leaves', async () => {
        render(mask());
        const btn = screen.getByRole('button', { name: 'Mask' });
        fireEvent.pointerEnter(btn);
        fireEvent.pointerLeave(btn);
        fireEvent.pointerEnter(screen.getByRole('tooltip'));
        await new Promise((r) => setTimeout(r, 250));
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        fireEvent.pointerLeave(screen.getByRole('tooltip'));
        await act(() => new Promise((r) => setTimeout(r, 250)));
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('keeps the control\'s own onFocus/onPointerEnter handlers and aria-describedby', () => {
        let entered = 0;
        render(
            <Explain k="policy:keep">
                <button type="button" aria-describedby="other" onPointerEnter={() => entered++}>
                    Keep
                </button>
            </Explain>
        );
        const btn = screen.getByRole('button', { name: 'Keep' });
        fireEvent.pointerEnter(btn);
        expect(entered).toBe(1);
        expect(btn.getAttribute('aria-describedby')).toMatch(/^other /);
    });

    it('explains a disabled control on hover (React drops mouse enter on disabled buttons)', () => {
        render(
            <Explain k="action.process">
                <button type="button" disabled>
                    Go
                </button>
            </Explain>
        );
        fireEvent.pointerEnter(screen.getByRole('button', { name: 'Go' }));
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('a press elsewhere dismisses a tip left open by touch', () => {
        render(mask());
        fireEvent.pointerEnter(screen.getByRole('button', { name: 'Mask' }));
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('shows one tip at a time, and the inner control wins over the one around it', () => {
        render(
            <Explain k="grid.region">
                <div>
                    <Explain k="policy:hash">
                        <button type="button">Inner</button>
                    </Explain>
                </div>
            </Explain>
        );
        const inner = screen.getByRole('button', { name: 'Inner' });
        fireEvent.pointerEnter(inner.parentElement!);
        fireEvent.pointerEnter(inner);
        const tips = screen.getAllByRole('tooltip');
        expect(tips).toHaveLength(1);
        expect(tips[0]).toHaveTextContent(POLICY_EXPLANATIONS.hash);
    });

    it('uses a text override', () => {
        render(
            <Explain k="demo.group" text="Custom words">
                <button type="button">x</button>
            </Explain>
        );
        fireEvent.pointerEnter(screen.getByRole('button'));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Custom words');
    });

    it('renders no tooltip, no handlers and no aria-describedby when the setting is off', () => {
        useExplainStore.setState({ enabled: false });
        render(mask());
        const btn = screen.getByRole('button', { name: 'Mask' });
        fireEvent.pointerEnter(btn);
        act(() => btn.focus());
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(btn).not.toHaveAttribute('aria-describedby');
        expect(btn).not.toHaveAttribute('data-explain');
    });

    it('removes an open tooltip when the setting is switched off', () => {
        render(
            <>
                <ExplainToggle />
                {mask()}
            </>
        );
        fireEvent.pointerEnter(screen.getByRole('button', { name: 'Mask' }));
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('switch', { name: /show explanations on hover/i }));
        expect(screen.queryByRole('tooltip')).toBeNull();
    });
});

describe('ExplainToggle and its store', () => {
    it('is a switch, on by default, and flips aria-checked', () => {
        render(<ExplainToggle />);
        const sw = screen.getByRole('switch', { name: 'Show explanations on hover' });
        expect(sw).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(sw);
        expect(sw).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(sw);
        expect(sw).toHaveAttribute('aria-checked', 'true');
    });

    it('persists the choice in localStorage', () => {
        render(<ExplainToggle />);
        fireEvent.click(screen.getByRole('switch'));
        expect(localStorage.getItem(EXPLAIN_STORAGE_KEY)).toBe('off');
        fireEvent.click(screen.getByRole('switch'));
        expect(localStorage.getItem(EXPLAIN_STORAGE_KEY)).toBe('on');
    });

    it('reads a stored OFF on load, defaults to ON otherwise, and survives blocked storage', async () => {
        const fresh = async () => {
            vi.resetModules();
            return (await import('../store/explainStore')).useExplainStore.getState().enabled;
        };
        expect(await fresh()).toBe(true);
        localStorage.setItem(EXPLAIN_STORAGE_KEY, 'off');
        expect(await fresh()).toBe(false);
        localStorage.setItem(EXPLAIN_STORAGE_KEY, 'garbage');
        expect(await fresh()).toBe(true);

        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        try {
            expect(await fresh()).toBe(true);
            useExplainStore.getState().setEnabled(false);
            expect(useExplainStore.getState().enabled).toBe(false);
        } finally {
            spy.mockRestore();
            set.mockRestore();
        }
    });
});
