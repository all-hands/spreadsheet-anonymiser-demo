import { useEffect, useId, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { clsx } from 'clsx';
import { useTheme } from '../themes/theme-context';
import { themes } from '../themes/themes';
import Explain from './Explain';

interface ThemeSelectorProps {
    menuClassName?: string;
}

const ThemeSelector = ({ menuClassName = 'right-0 top-full mt-1' }: ThemeSelectorProps) => {
    const { theme, setTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuId = useId();

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <Explain k="theme">
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-label="Colour theme"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-controls={open ? menuId : undefined}
                    className="p-1.5 rounded-lg border border-border bg-surface text-muted hover:text-foreground hover:bg-surface-hover focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <Palette size={16} aria-hidden="true" />
                </button>
            </Explain>
            {open && (
                <ul
                    id={menuId}
                    role="menu"
                    aria-label="Colour theme"
                    className={clsx(
                        'absolute z-50 min-w-44 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl py-1',
                        menuClassName,
                    )}
                >
                    {themes.map((t) => (
                        <li key={t.key} role="none">
                            <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={t.key === theme.key}
                                onClick={() => {
                                    setTheme(t.key);
                                    setOpen(false);
                                }}
                                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-left text-foreground hover:bg-surface-hover focus:outline-hidden focus-visible:bg-surface-hover"
                            >
                                {t.name}
                                {t.key === theme.key && <Check size={14} aria-hidden="true" />}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default ThemeSelector;
