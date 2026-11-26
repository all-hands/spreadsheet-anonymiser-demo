import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import SimpleLayout from './layouts/SimpleLayout';
import SimpleMode from './pages/SimpleMode';
import AdvancedLayout from './layouts/AdvancedLayout';
import AdvancedDashboard from './pages/AdvancedDashboard';
import PreviewPage from './pages/PreviewPage';
import CertificatePage from './pages/CertificatePage';
import { RouteError } from './components/ErrorPanel';

export const routes: RouteObject[] = [
    {
        path: '/',
        element: <SimpleLayout />,
        errorElement: <RouteError />,
        children: [
            {
                index: true,
                element: <Navigate to="/simple" replace />
            },
            {
                path: 'simple',
                element: <SimpleMode />
            },
        ]
    },
    {
        path: '/advanced',
        element: <AdvancedLayout />,
        errorElement: <RouteError />,
        children: [
            {
                index: true,
                element: <AdvancedDashboard />
            },
            {
                path: 'preview',
                element: <PreviewPage />
            },
            {
                path: 'certificate',
                element: <CertificatePage />
            },
        ]
    },
    {
        path: '*',
        element: <Navigate to="/simple" replace />
    }
];

export const router = createBrowserRouter(routes);
