import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import ExplainToggle from '../components/ExplainToggle';
import Explain from '../components/Explain';

const AdvancedLayout = () => {
    return (
        <div className="flex flex-col md:flex-row min-h-screen md:h-screen w-full bg-background text-foreground md:overflow-hidden">
            <Sidebar />
            <main className="flex-1 min-w-0 flex flex-col md:overflow-auto bg-background">
                <header className="min-h-16 shrink-0 border-b border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 md:px-8">
                    <Explain k="page.heading">
                        <h2 className="text-lg font-medium text-foreground">Dashboard</h2>
                    </Explain>
                    <ExplainToggle />
                </header>
                <div className="flex-1 p-4 md:p-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdvancedLayout;
