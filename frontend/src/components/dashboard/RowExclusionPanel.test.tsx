import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RowExclusionPanel from './RowExclusionPanel';
import { useDatasetStore } from '../../store/datasetStore';
import type { RowData } from '../../types/data';

const ROWS: RowData[] = [
    ['Ann', 'a@x.com'],
    ['Bo', 'b@x.com'],
    ['Cy', 'c@x.com'],
];

let rectSpy: ReturnType<typeof vi.spyOn>;
const SIZE_PROPS = {
    offsetHeight: 400,
    offsetWidth: 800,
    clientHeight: 400,
    clientWidth: 800,
} as const;
const ownDescs: Record<string, PropertyDescriptor | undefined> = Object.fromEntries(
    Object.keys(SIZE_PROPS).map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)]),
);

beforeEach(() => {
    useDatasetStore.setState({ excludedRows: new Set() });
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 800,
        height: 400,
        top: 0,
        left: 0,
        bottom: 400,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    } as DOMRect);
    for (const [k, v] of Object.entries(SIZE_PROPS)) {
        Object.defineProperty(HTMLElement.prototype, k, {
            get: () => v,
            configurable: true,
        });
    }
});

afterEach(() => {
    rectSpy.mockRestore();
    for (const k of Object.keys(SIZE_PROPS)) {
        const own = ownDescs[k];
        if (own) {
            Object.defineProperty(HTMLElement.prototype, k, own);
        } else {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
        }
    }
});

describe('RowExclusionPanel', () => {
    it('renders a checkbox for the dataset rows, labeled 1-based (row 1 is the first data row)', () => {
        render(<RowExclusionPanel rows={ROWS} />);

        ROWS.forEach((_, i) => {
            expect(screen.getByLabelText(`Exclude row ${i + 1}`)).toBeInTheDocument();
        });
    });

    it('summarizes how many rows will be exported', () => {
        render(<RowExclusionPanel rows={ROWS} />);

        expect(screen.getByText('3 of 3 will be exported')).toBeInTheDocument();
    });

    it('a checkbox click excludes the row in the store and updates the summary', () => {
        render(<RowExclusionPanel rows={ROWS} />);
        expect(screen.getByText('3 of 3 will be exported')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Exclude row 1'));

        const { excludedRows } = useDatasetStore.getState();
        expect(excludedRows.size).toBe(1);
        expect(excludedRows.has(0)).toBe(true);
        expect(screen.getByLabelText('Exclude row 1')).toBeChecked();
        expect(screen.getByText('2 of 3 will be exported')).toBeInTheDocument();
    });

    it('Clear exclusions empties the set and is disabled while none exist', () => {
        render(<RowExclusionPanel rows={ROWS} />);
        const clear = screen.getByRole('button', { name: 'Clear exclusions' });
        expect(clear).toBeDisabled();

        fireEvent.click(screen.getByLabelText('Exclude row 3'));
        expect(clear).toBeEnabled();
        fireEvent.click(clear);

        expect(useDatasetStore.getState().excludedRows.size).toBe(0);
        expect(screen.getByText('3 of 3 will be exported')).toBeInTheDocument();
        expect(screen.getByLabelText('Exclude row 3')).not.toBeChecked();
    });

    it('renders the empty state when no file is loaded', () => {
        render(<RowExclusionPanel rows={[]} />);

        expect(screen.getByText('Load a file to exclude rows.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Exclude row 1')).not.toBeInTheDocument();
    });

    it('every row has the same fixed-width cells: ten-plus row numbers do not shift columns', () => {
        const many: RowData[] = Array.from({ length: 12 }, (_, i) => [`n${i}`, `m${i}`]);
        render(<RowExclusionPanel rows={many} />);
        const lead = (i: number) => screen.getByLabelText(`Exclude row ${i + 1}`).parentElement!;
        expect(lead(2).className).toBe(lead(10).className);
        expect(lead(10).className).toContain('w-24');
        const cells = lead(10).parentElement!.querySelectorAll(':scope > div');
        expect(cells).toHaveLength(3);
        expect(cells[1].className).toContain('w-56');
        expect(cells[1].className).toBe(cells[2].className);
        expect(lead(10).parentElement!.className).toContain('h-10');
    });

    it('shortens a long value to first10…last10 with the full value in the title', () => {
        render(<RowExclusionPanel rows={[['abcdefghijklmnopqrstuvwxyz', 'x']]} />);
        expect(screen.getByTitle('abcdefghijklmnopqrstuvwxyz')).toBeInTheDocument();
        expect(screen.getByText('abcdefghij…qrstuvwxyz')).toBeInTheDocument();
    });

    it('has the top and bottom horizontal scrollbars', () => {
        render(<RowExclusionPanel rows={ROWS} />);
        expect(screen.getByTestId('scroll-top')).toBeInTheDocument();
        expect(screen.getByTestId('scroll-main')).toBeInTheDocument();
    });
});
