import { describe, it, expect, beforeEach } from 'vitest';
import { OLD_STORAGE_KEY, readStoredTheme, STORAGE_KEY } from './theme-context';
import { defaultTheme } from './themes';

beforeEach(() => localStorage.clear());

describe('theme ids', () => {
    it('defaults first-time visitors to the dark theme', () => {
        expect(defaultTheme.isDark).toBe(true);
        expect(defaultTheme.key).toBe('default-dark');
        expect(readStoredTheme()).toBe(defaultTheme);
    });

    it('lets a stored light choice win over the default', () => {
        localStorage.setItem(STORAGE_KEY, 'classic-navy');
        expect(readStoredTheme().key).toBe('classic-navy');
    });

    it('does not take the old default, stored unasked by older builds, for a choice', () => {
        localStorage.setItem(OLD_STORAGE_KEY, 'classic-navy');
        expect(readStoredTheme()).toBe(defaultTheme);
        localStorage.setItem(OLD_STORAGE_KEY, 'forest');
        expect(readStoredTheme().key).toBe('forest');
        localStorage.setItem(STORAGE_KEY, 'ocean');
        expect(readStoredTheme().key).toBe('ocean');
    });

    it('keeps a current id and falls back to the default for unknown ones', () => {
        localStorage.setItem(STORAGE_KEY, 'ocean');
        expect(readStoredTheme().key).toBe('ocean');
        localStorage.setItem(STORAGE_KEY, 'nonsense');
        expect(readStoredTheme()).toBe(defaultTheme);
    });
});
