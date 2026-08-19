/** TanStack Query bindings over the Swarm API client. */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from './client';
import type { SettingsTree } from '@/settings/types';
import type { CurrentStatus, ListT2IParamsResponse, SessionData } from './types';

export const queryKeys = {
    session: ['session'] as const,
    t2iParams: ['t2i-params'] as const,
    currentStatus: ['current-status'] as const,
    userSettings: ['user-settings'] as const,
    serverSettings: ['server-settings'] as const
};

/** Establishes the API session. Everything else depends on this resolving. */
export function useSession(): UseQueryResult<SessionData> {
    return useQuery({
        queryKey: queryKeys.session,
        queryFn: () => api.connect(),
        staleTime: Infinity,
        retry: 1
    });
}

/** The full generation parameter schema — the backbone of the form system. */
export function useT2IParams(enabled = true): UseQueryResult<ListT2IParamsResponse> {
    return useQuery({
        queryKey: queryKeys.t2iParams,
        queryFn: () => api.post<ListT2IParamsResponse>('ListT2IParams'),
        // Only changes when the server reloads models or the user edits param config.
        staleTime: 5 * 60 * 1000,
        enabled
    });
}

/** Backend health and generation counters.
 *  Polls fast while something is wrong or running, slowly when idle — mirroring the interval
 *  switch in reviseStatusBar (src/wwwroot/js/genpage/main.js:154). */
export function useCurrentStatus(enabled = true): UseQueryResult<CurrentStatus> {
    return useQuery({
        queryKey: queryKeys.currentStatus,
        queryFn: () => api.post<CurrentStatus>('GetCurrentStatus'),
        enabled,
        refetchInterval: query => {
            const data = query.state.data;
            if (!data) {
                return 5_000;
            }
            const busy = data.backend_status.class !== '' || data.status.live_gens > 0 || data.status.waiting_gens > 0;
            return busy ? 2_000 : 60_000;
        }
    });
}

/** The user's own settings tree, backing both the Preferences screen and the command palette. */
export function useUserSettings(enabled = true): UseQueryResult<{ settings: SettingsTree }> {
    return useQuery({
        queryKey: queryKeys.userSettings,
        queryFn: () => api.post<{ settings: SettingsTree }>('GetUserSettings'),
        staleTime: 5 * 60 * 1000,
        enabled
    });
}

/** The server-wide settings tree. Requires the read_server_settings permission. */
export function useServerSettings(enabled = true): UseQueryResult<{ settings: SettingsTree }> {
    return useQuery({
        queryKey: queryKeys.serverSettings,
        queryFn: () => api.post<{ settings: SettingsTree }>('ListServerSettings'),
        staleTime: 5 * 60 * 1000,
        enabled
    });
}
