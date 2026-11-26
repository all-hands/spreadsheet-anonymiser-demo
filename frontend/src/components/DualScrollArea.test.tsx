import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DualScrollArea from './DualScrollArea';
import { linkScroll } from '../lib/scroll-link';
import CellText from './CellText';

describe('DualScrollArea', () => {
    it('renders a top mirror bar and a labelled main scroller', () => {
        render(<DualScrollArea label="Grid" explain="grid.region"><div>content</div></DualScrollArea>);
        expect(screen.getByTestId('scroll-top')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Grid' })).toBeTruthy();
    });

    it('mirrors horizontal scroll both ways', () => {
        render(<DualScrollArea explain="grid.region"><div>x</div></DualScrollArea>);
        const top = screen.getByTestId('scroll-top');
        const main = screen.getByTestId('scroll-main');
        main.scrollLeft = 120;
        fireEvent.scroll(main);
        expect(top.scrollLeft).toBe(120);
        top.scrollLeft = 40;
        fireEvent.scroll(top);
        expect(main.scrollLeft).toBe(40);
    });
});

describe('linkScroll', () => {
    it('copies both offsets and ignores nulls', () => {
        const a = document.createElement('div');
        const b = document.createElement('div');
        a.scrollLeft = 30;
        a.scrollTop = 70;
        linkScroll(a, b);
        expect([b.scrollLeft, b.scrollTop]).toEqual([30, 70]);
        expect(() => linkScroll(null, b)).not.toThrow();
    });
});

describe('CellText', () => {
    it('shows short values whole with a title', () => {
        render(<CellText value="Alice" />);
        expect(screen.getByTitle('Alice').textContent).toBe('Alice');
    });
    it('shortens long values, keeping the full one in title and for screen readers', () => {
        const full = '0123456789ABCDEFGHIJKLMNO';
        render(<CellText value={full} />);
        expect(screen.getByTitle(full)).toBeTruthy();
        expect(screen.getByText('0123456789…FGHIJKLMNO').getAttribute('aria-hidden')).toBe('true');
        expect(screen.getByText(full).className).toContain('sr-only');
    });
    it('marks empty cells', () => {
        render(<CellText value={null} />);
        expect(screen.getByText('—')).toBeTruthy();
    });
});
