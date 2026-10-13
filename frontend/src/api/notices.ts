/** App-wide notices the API client raises, for the shell to show. */

import { create } from 'zustand';

interface ApiNoticeStore {
    /** Set once the server reports a different build than this page loaded against. The page keeps
     *  working, but its code and the server's may no longer agree, so it asks for a reload - the
     *  same notice the legacy page shows (site.js `serverHasUpdated`). */
    serverUpdated: boolean;
    setServerUpdated: () => void;
    dismissServerUpdated: () => void;
}

export const useApiNotices = create<ApiNoticeStore>(set => ({
    serverUpdated: false,
    setServerUpdated: () => set({ serverUpdated: true }),
    dismissServerUpdated: () => set({ serverUpdated: false })
}));
