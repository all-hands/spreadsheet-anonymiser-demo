import { LayoutDashboard, Eye, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import ThemeSelector from './ThemeSelector';
import Explain from './Explain';
import SourceLink from './SourceLink';
import type { ExplanationKey } from '../lib/explanations';

const Sidebar = () => {
    const location = useLocation();

    const navItems: { name: string; icon: typeof Eye; path: string; explain: ExplanationKey }[] = [
        { name: 'Dashboard', icon: LayoutDashboard, path: '/advanced', explain: 'nav.dashboard' },
        { name: 'Preview', icon: Eye, path: '/advanced/preview', explain: 'nav.preview' },
        { name: 'Certificate', icon: ShieldCheck, path: '/advanced/certificate', explain: 'nav.certificate' },
    ];

    return (
        <aside className="w-full md:w-64 md:shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border flex flex-col">
            <div className="px-4 pt-4 pb-2 md:p-6">
                <Explain k="app.title">
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-accent-hover to-accent-hover">
                    Spreadsheet Anonymiser
                    <span className="text-xs font-normal text-muted block">Advanced Mode</span>
                </h1>
                </Explain>
            </div>

            <nav className="flex-1 px-4 pb-3 md:pb-0 flex flex-wrap md:flex-col gap-2">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                        <Explain key={item.path} k={item.explain} side="right">
                        <Link
                            to={item.path}
                            className={clsx(
                                "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium",
                                isActive
                                    ? "text-accent-hover border"
                                    : "text-muted hover:bg-surface-hover hover:text-foreground"
                            )}
                        >
                            <item.icon size={18} />
                            {item.name}
                        </Link>
                        </Explain>
                    );
                })}
            </nav>

            <div className="px-4 py-3 md:p-4 border-t border-border flex flex-row md:flex-col flex-wrap items-center md:items-stretch justify-between gap-3">
                <ThemeSelector menuClassName="left-0 top-full mt-1 md:top-auto md:bottom-full md:mb-1 md:mt-0" />
                <Explain k="nav.simple" side="right">
                    <Link to="/simple" className="text-xs text-muted hover:text-foreground transition-colors">
                        &larr; Back to Simple Mode
                    </Link>
                </Explain>
                <SourceLink />
            </div>
        </aside>
    );
};

export default Sidebar;
