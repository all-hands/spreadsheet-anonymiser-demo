import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSelector from './ThemeSelector';
import { ThemeProvider } from '../themes/ThemeProvider';
import { themes } from '../themes/themes';

const renderSelector = () =>
    render(
        <ThemeProvider>
            <ThemeSelector />
        </ThemeProvider>,
    );

describe('ThemeSelector', () => {
    beforeEach(() => localStorage.clear());

    it('opens a menu of every theme and closes it on a pick', () => {
        renderSelector();
        const button = screen.getByRole('button', { name: 'Colour theme' });
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('menu')).toBeNull();

        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
        const items = screen.getAllByRole('menuitemradio');
        expect(items).toHaveLength(themes.length);
        expect(items.filter((i) => i.getAttribute('aria-checked') === 'true')).toHaveLength(1);

        const other = themes[themes.length - 1];
        fireEvent.click(screen.getByRole('menuitemradio', { name: other.name }));
        expect(screen.queryByRole('menu')).toBeNull();

        fireEvent.click(button);
        expect(screen.getByRole('menuitemradio', { name: other.name })).toHaveAttribute('aria-checked', 'true');
    });

    it('closes on Escape and on a click outside', () => {
        renderSelector();
        const button = screen.getByRole('button', { name: 'Colour theme' });
        fireEvent.click(button);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();

        fireEvent.click(button);
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
