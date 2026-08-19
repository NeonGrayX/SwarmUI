import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { applyThemeCss, applyThemePolarity, storedIsDark, storedThemeId } from './theme/useTheme';
import './styles/index.css';

// Paint the previously chosen theme immediately; useThemes reconciles with the server after load.
const remembered = storedThemeId();
if (remembered) {
    // Matches the registrations in WebServer.cs: 'modern'-based themes layer on a shared base.
    const base = ['modern_dark', 'modern_light', 'solarized', 'swarmpunk', 'beweish'].includes(remembered) ||
        remembered.startsWith('ctp_')
        ? ['css/themes/modern.css']
        : [];
    applyThemeCss([...base, `css/themes/${remembered}.css`]);
    applyThemePolarity(storedIsDark());
}

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1
        }
    }
});

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root container missing from index.html');
}

createRoot(container).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>
);
