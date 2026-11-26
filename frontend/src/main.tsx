import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { RouterProvider } from 'react-router-dom'
import { router } from './router.tsx'
import { ThemeProvider } from './themes/ThemeProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { logFailure } from './lib/log'

createRoot(document.getElementById('root')!, {
  onCaughtError: (e) => logFailure('Render error', e),
  onUncaughtError: (e) => logFailure('Uncaught error', e),
}).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
