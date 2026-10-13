/** Theme application.
 *
 * The themes registered in WebServer.cs are plain CSS files that override a shared set of custom
 * properties (--background, --text, --emphasis, ...). Because src/styles/tokens.css deliberately
 * adopts those same property names, loading a theme's stylesheet re-themes this UI too - no port
 * needed. Theme links are appended to <head> after the bundle so they win on equal specificity.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys, useSession, useUserSettings } from '@/api/hooks';
import type { ThemeInfo } from '@/api/types';

export type { ThemeInfo };

const STORAGE_KEY = 'swarm-ui-theme';
const DARK_KEY = 'swarm-ui-theme-dark';
const VARY_KEY = 'swarm-ui-theme-vary';
const LINK_ATTR = 'data-swarm-theme';

/** Locally remembered theme id, so the correct theme paints before the API responds. */
export function storedThemeId(): string | null {
    return localStorage.getItem(STORAGE_KEY);
}

/** Last-known polarity of the remembered theme, so the pre-paint bootstrap picks the right one. */
export function storedIsDark(): boolean {
    return localStorage.getItem(DARK_KEY) !== 'false';
}

/** Records the theme's polarity on <html>.
 *
 * tokens.css keys its light-theme status palette off this: the semantic colours (--backend-errored,
 * --star, --status-bar-warn-*) are the one group no theme file declares, so they would otherwise
 * keep their dark-tuned values on Eyesear White, Solarized, Modern Light and Catppuccin Latte. */
export function applyThemePolarity(isDark: boolean): void {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    localStorage.setItem(DARK_KEY, String(isDark));
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
    const hrefs = paths.map(path => {
        const clean = path.replace(/^\//, '');
        return vary ? `/${clean}?vary=${encodeURIComponent(vary)}` : `/${clean}`;
    });
    const existing = Array.from(document.querySelectorAll<HTMLLinkElement>(`link[${LINK_ATTR}]`));
    // Already showing exactly these: swapping the links anyway would drop the styles for the frame
    // or two the browser takes to re-apply them, which is a visible flash.
    if (existing.length === hrefs.length && existing.every((link, i) => link.getAttribute('href') === hrefs[i])) {
        return;
    }
    for (const old of existing) {
        old.remove();
    }
    for (const href of hrefs) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute(LINK_ATTR, 'true');
        link.href = href;
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

    const settings = useUserSettings(session.isSuccess);

    const rawThemes = settings.data?.themes;
    const themes = useMemo(() => rawThemes ?? {}, [rawThemes]);
    const current = String(settings.data?.settings?.theme?.value ?? storedThemeId() ?? 'modern_dark');

    const setTheme = useCallback(
        async (id: string) => {
            const theme = themes[id];
            if (theme) {
                applyThemeCss(theme.css_paths, vary);
                applyThemePolarity(theme.is_dark);
                localStorage.setItem(STORAGE_KEY, id);
            }
            // Persist to the user profile so the legacy UI picks up the same choice.
            await api.post('ChangeUserSettings', { settings: { theme: id } });
            await queryClient.invalidateQueries({ queryKey: queryKeys.userSettings });
        },
        [themes, queryClient, vary]
    );

    // Apply whatever the server says once it loads, in case it differs from the local guess.
    useEffect(() => {
        const theme = themes[current];
        if (theme) {
            applyThemeCss(theme.css_paths, vary);
            applyThemePolarity(theme.is_dark);
            localStorage.setItem(STORAGE_KEY, current);
        }
    }, [current, themes, vary]);

    return { themes, current, setTheme, isPending: settings.isPending };
}
