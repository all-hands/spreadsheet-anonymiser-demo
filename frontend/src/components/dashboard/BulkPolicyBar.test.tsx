import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import BulkPolicyBar from './BulkPolicyBar';
import PolicyGrid from './PolicyGrid';
import { useState } from 'react';
import { useDatasetStore } from '../../store/datasetStore';
import { useAdvancedSessionStore } from '../../store/advancedSessionStore';

const HEADERS = ['a', 'b', 'c'];
const types = () => [0, 1, 2].map((i) => useDatasetStore.getState().policies[i]?.type);

beforeEach(() => {
    useDatasetStore.setState({
        policies: { 0: { type: 'keep' }, 1: { type: 'hash' }, 2: { type: 'keep' } },
    });
});

const choose = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('BulkPolicyBar', () => {
    it('applies to all columns and announces the count', () => {
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        choose('Policy to apply', 'redact');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(types()).toEqual(['redact', 'redact', 'redact']);
        expect(screen.getByRole('status')).toHaveTextContent('Applied redact to 3 columns');
    });

    it('Undo after Apply restores the pre-Apply policies and names the bulk action', () => {
        useAdvancedSessionStore.getState().snapshot('Earlier action');
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        choose('Policy to apply', 'redact');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(types()).toEqual(['redact', 'redact', 'redact']);
        const undo = screen.getByRole('button', { name: 'Undo Bulk apply redact' });
        fireEvent.click(undo);
        expect(types()).toEqual(['keep', 'hash', 'keep']);
        expect(screen.getByRole('status')).toHaveTextContent('Undone: Bulk apply redact.');
    });

    it('selected scope touches only ticked columns and disables Apply when none', () => {
        const { rerender } = render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        choose('Columns to apply to', 'selected');
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        expect(screen.getByText('Tick at least one column in the grid first.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apply' })).toHaveAccessibleDescription(/Tick at least one column/);
        rerender(<BulkPolicyBar headers={HEADERS} selected={new Set([1])} />);
        choose('Policy to apply', 'redact');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(types()).toEqual(['keep', 'redact', 'keep']);
        expect(screen.getByRole('status')).toHaveTextContent('Applied redact to 1 column');
    });

    it('keep scope leaves configured columns alone', () => {
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        choose('Columns to apply to', 'keep');
        choose('Policy to apply', 'redact');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(types()).toEqual(['redact', 'hash', 'redact']);
    });

    it('applies width and reference date to every affected column', () => {
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        choose('Policy to apply', 'age-band');
        fireEvent.change(screen.getByLabelText('Width for bulk apply'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        const { policies } = useDatasetStore.getState();
        for (const i of [0, 1, 2]) {
            expect(policies[i]).toMatchObject({ type: 'age-band', width: 5 });
            expect(policies[i].referenceDate).toBeTruthy();
        }
    });

    it('Reset all to Keep', () => {
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Reset all to Keep' }));
        expect(types()).toEqual(['keep', 'keep', 'keep']);
        expect(screen.getByRole('status')).toHaveTextContent('Reset 3 columns to keep');
    });
});

describe('PolicyGrid selection', () => {
    const Harness = () => {
        const [sel, setSel] = useState<ReadonlySet<number>>(new Set());
        return (
            <>
                <BulkPolicyBar headers={HEADERS} selected={sel} />
                <PolicyGrid headers={HEADERS} rows={[]} policies={{}} selected={sel} onSelectionChange={setSel} />
            </>
        );
    };

    it('has a labelled checkbox per column, select-all and clear', () => {
        render(<Harness />);
        const box = (h: string) => screen.getByLabelText(`Select column "${h}"`) as HTMLInputElement;
        fireEvent.click(box('b'));
        expect(box('b').checked).toBe(true);
        expect(box('a').checked).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
        expect(HEADERS.every((h) => box(h).checked)).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(HEADERS.some((h) => box(h).checked)).toBe(false);
    });

    it('ticked columns drive the bar', () => {
        render(<Harness />);
        fireEvent.click(screen.getByLabelText('Select column "c"'));
        choose('Columns to apply to', 'selected');
        choose('Policy to apply', 'redact');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(types()).toEqual(['keep', 'hash', 'redact']);
    });
});
