import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import * as Tooltip from '@radix-ui/react-tooltip';
import { router } from './router';
import { applyThemeCss, applyThemePolarity, storedIsDark, storedThemeId } from './theme/useTheme';
import { bootstrapI18n } from './i18n';
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

const root = createRoot(container);

// Resolve the stored language before the first render, so the UI never flashes English on its way
// to the user's actual language. The server-keyed table loads later, once there is a session.
// Chained rather than top-level `await`, which the build target (es2020) does not allow.
void bootstrapI18n().finally(() => {
    root.render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                {/* Field help and other hover hints open on hover alone, so one provider covers the app. */}
                <Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
                    <RouterProvider router={router} />
                </Tooltip.Provider>
            </QueryClientProvider>
        </StrictMode>
    );
});
