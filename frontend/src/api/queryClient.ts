/** The app's one TanStack Query client, shared with the non-React code that needs its cache. */

import { QueryClient } from '@tanstack/react-query';
import type { SettingsTree } from '@/settings/types';
import { queryKeys, type UserSettingsResponse } from './hooks';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1
        }
    }
});

/** A user setting by dotted path (eg `audio.completionsound`) from whatever GetUserSettings last
 *  returned, for code outside React - the generation store, mostly. `fallback` until the settings
 *  have loaded at all, or when the setting is absent.
 *
 * The tree is keyed by lowercased field names (AdminAPI.AutoConfigToParamData), so the path is too. */
export function readUserSetting<T>(path: string, fallback: T): T {
    let level: SettingsTree | undefined = queryClient.getQueryData<UserSettingsResponse>(queryKeys.userSettings)?.settings;
    const parts = path.toLowerCase().split('.');
    for (let i = 0; i < parts.length; i++) {
        const node = level?.[parts[i]];
        if (!node) {
            return fallback;
        }
        if (i === parts.length - 1) {
            return node.value === undefined || node.value === null ? fallback : (node.value as T);
        }
        level = node.type === 'group' ? (node.value as SettingsTree) : undefined;
    }
    return fallback;
}
