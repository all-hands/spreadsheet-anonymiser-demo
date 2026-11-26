import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider } from './ThemeProvider';
import { STORAGE_KEY, useTheme } from './theme-context';

beforeEach(() => localStorage.clear());

describe('ThemeProvider', () => {
    it('marks the root with the theme mode so status colours match the surface', () => {
        const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
        expect(document.documentElement.dataset.themeMode).toBe('dark');
        act(() => result.current.setTheme('ocean'));
        expect(document.documentElement.dataset.themeMode).toBe('light');
        act(() => result.current.setTheme('midnight'));
        expect(document.documentElement.dataset.themeMode).toBe('dark');
    });

    it('stores a theme only when it is chosen', () => {
        const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        act(() => result.current.setTheme('classic-navy'));
        expect(localStorage.getItem(STORAGE_KEY)).toBe('classic-navy');
    });
});
