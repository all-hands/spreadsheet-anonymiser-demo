import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PreviewTable from './PreviewTable';
import { CELL_WIDTH_REM } from '../lib/cell-display';

describe('PreviewTable', () => {
    it('gives the header and the body the same fixed total width', () => {
        const { container } = render(
            <PreviewTable headers={['a', 'b', 'c']} data={[]} metadata={[]} />,
        );
        const widths = Array.from(container.querySelectorAll<HTMLElement>('[style*="width"]'))
            .map((el) => el.style.width)
            .filter((w) => w.endsWith('rem'));
        expect(new Set(widths)).toEqual(new Set([`${3 * CELL_WIDTH_REM}rem`]));
    });
    it('renders header cells and a top scrollbar', () => {
        render(<PreviewTable headers={['name']} data={[]} metadata={[{ index: 0, name: 'name', type: 'text' } as never]} />);
        expect(screen.getByTitle('name')).toBeTruthy();
        expect(screen.getByTestId('scroll-top')).toBeTruthy();
    });
    it('counts against the whole file when given only a preview slice', () => {
        const slice = Array.from({ length: 50 }, (_, i) => [String(i)]);
        render(<PreviewTable headers={['a']} data={slice} metadata={[]} totalRows={60} />);
        expect(screen.getByText('Showing 50 of 60 rows')).toBeTruthy();
    });
});
