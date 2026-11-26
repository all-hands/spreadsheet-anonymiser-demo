import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { defaultTheme, themes } from './themes';
import type { Theme } from './themes';
import { readStoredTheme, STORAGE_KEY, ThemeContext } from './theme-context';

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    const [theme, setThemeState] = useState<Theme>(readStoredTheme);

    useEffect(() => {
        const root = document.documentElement;
        root.dataset.themeMode = theme.isDark ? 'dark' : 'light';
        for (const [name, value] of Object.entries(theme.vars)) {
            root.style.setProperty(name, value);
        }
    }, [theme]);

    const setTheme = (key: string) => {
        const next = themes.find((t) => t.key === key) ?? defaultTheme;
        setThemeState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next.key);
        } catch {
            // private mode: preference just won't persist
        }
    };

    return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};
