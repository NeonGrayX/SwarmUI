/** TanStack Query bindings over the Swarm API client. */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from './client';
import type { CurrentStatus, ListT2IParamsResponse, SessionData } from './types';

export const queryKeys = {
    session: ['session'] as const,
    t2iParams: ['t2i-params'] as const,
    currentStatus: ['current-status'] as const
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
