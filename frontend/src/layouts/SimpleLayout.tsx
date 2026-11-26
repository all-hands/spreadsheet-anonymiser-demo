import { Link, Outlet } from 'react-router-dom';
import ThemeSelector from '../components/ThemeSelector';
import ExplainToggle from '../components/ExplainToggle';
import Explain from '../components/Explain';
import SourceLink from '../components/SourceLink';

const SimpleLayout = () => {
    return (
        <div className="min-h-screen w-full bg-linear-to-br from-background to-background text-foreground flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-4xl backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-8">
                <header className="mb-8 text-center relative">
                    <div className="absolute -top-2 -right-6 flex flex-col items-end gap-2">
                        <ThemeSelector />
                        <ExplainToggle />
                    </div>
                    <Explain k="app.title">
                    <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-accent-hover to-accent-hover">
                        Spreadsheet Anonymiser
                    </h1>
                    </Explain>
                    <p className="text-muted mt-2">Secure. Offline. Fast.</p>
                </header>
                <main>
                    <Outlet />
                </main>
            </div>
            <Explain k="nav.advanced">
                <Link
                    to="/advanced"
                    className="mt-4 text-sm text-muted hover:text-accent-hover transition-colors"
                >
                    Need per-column control? Open the Advanced dashboard &rarr;
                </Link>
            </Explain>
            <SourceLink className="mt-3" />
        </div>
    );
};

export default SimpleLayout;
