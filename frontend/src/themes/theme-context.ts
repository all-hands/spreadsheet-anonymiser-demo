import { createContext, useContext } from 'react';
import { defaultTheme, themes } from './themes';
import type { Theme } from './themes';

export const STORAGE_KEY = 'anonymiser-theme-choice';
export const OLD_STORAGE_KEY = 'anonymiser-theme';
const OLD_DEFAULT = 'classic-navy';

export interface ThemeContextValue {
    theme: Theme;
    setTheme: (key: string) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const readStoredTheme = (): Theme => {
    try {
        const old = localStorage.getItem(OLD_STORAGE_KEY);
        const stored = localStorage.getItem(STORAGE_KEY) ?? (old === OLD_DEFAULT ? null : old);
        return themes.find((t) => t.key === stored) ?? defaultTheme;
    } catch {
        return defaultTheme;
    }
};

export const useTheme = (): ThemeContextValue => {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
    return ctx;
};
