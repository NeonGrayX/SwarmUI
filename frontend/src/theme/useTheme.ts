/** Theme application.
 *
 * The 14 themes registered in WebServer.cs are plain CSS files that override a shared set of custom
 * properties (--background, --text, --emphasis, ...). Because src/styles/tokens.css deliberately
 * adopts those same property names, loading a theme's stylesheet re-themes this UI too - no port
 * needed. Theme links are appended to <head> after the bundle so they win on equal specificity.
 */

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useSession } from '@/api/hooks';

export interface ThemeInfo {
    name: string;
    is_dark: boolean;
    css_paths: string[];
}

const STORAGE_KEY = 'swarm-ui-theme';
const VARY_KEY = 'swarm-ui-theme-vary';
const LINK_ATTR = 'data-swarm-theme';

/** Locally remembered theme id, so the correct theme paints before the API responds. */
export function storedThemeId(): string | null {
    return localStorage.getItem(STORAGE_KEY);
}

/** Last-known server build id, used to bust the theme stylesheet cache. */
export function storedVary(): string {
    return localStorage.getItem(VARY_KEY) ?? '';
}

/** Swaps the <link> elements for the given theme's stylesheets.
 *
 * The `vary` query mirrors what the Razor layout does for every stylesheet it emits
 * (`?vary=@Utilities.VaryID`). Without it the browser keeps serving a cached theme file across
 * server rebuilds, so edits to a theme silently don't apply. */
export function applyThemeCss(paths: string[], vary = storedVary()): void {
    for (const old of document.querySelectorAll(`link[${LINK_ATTR}]`)) {
        old.remove();
    }
    for (const path of paths) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute(LINK_ATTR, 'true');
        const clean = path.replace(/^\//, '');
        link.href = vary ? `/${clean}?vary=${encodeURIComponent(vary)}` : `/${clean}`;
        document.head.append(link);
    }
}

/** Themes available from the server, plus the current selection and a setter. */
export function useThemes() {
    const queryClient = useQueryClient();
    const session = useSession();
    const vary = session.data?.version ?? '';

    // Remember the build id so the pre-paint bootstrap in main.tsx can bust cache too.
    useEffect(() => {
        if (vary) {
            localStorage.setItem(VARY_KEY, vary);
        }
    }, [vary]);

    const settings = useQuery({
        queryKey: ['user-settings'],
        queryFn: () =>
            api.post<{ themes: Record<string, ThemeInfo>; settings: Record<string, { value: unknown }> }>(
                'GetUserSettings'
            )
    });

    const themes = settings.data?.themes ?? {};
    const current = String(settings.data?.settings?.theme?.value ?? storedThemeId() ?? 'modern_dark');

    const setTheme = useCallback(
        async (id: string) => {
            const theme = themes[id];
            if (theme) {
                applyThemeCss(theme.css_paths, vary);
                localStorage.setItem(STORAGE_KEY, id);
            }
            // Persist to the user profile so the legacy UI picks up the same choice.
            await api.post('ChangeUserSettings', { settings: { theme: id } });
            await queryClient.invalidateQueries({ queryKey: ['user-settings'] });
        },
        [themes, queryClient, vary]
    );

    // Apply whatever the server says once it loads, in case it differs from the local guess.
    useEffect(() => {
        const theme = themes[current];
        if (theme) {
            applyThemeCss(theme.css_paths, vary);
            localStorage.setItem(STORAGE_KEY, current);
        }
    }, [current, themes, vary]);

    return { themes, current, setTheme, isPending: settings.isPending };
}
