/** Which saved workflow the Simple workspace is driving.
 *
 * Only the name is kept. The parameter set behind it is rebuilt from the library on demand
 * (savedWorkflowInput in ./saved.ts) and installed in the shared workflow store, which the Simple
 * workspace hands back when it closes - so the name is the one piece of the choice that has to
 * outlive both the panel and a reload.
 *
 * Choosing a workflow from outside the workspace - the Library - goes through ./handoff.ts
 * instead, which is about reaching a workspace rather than about which workflow it is driving.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useOpenSavedWorkflow } from './actions';
import { useComfyWorkflowStore } from './store';

interface SimpleWorkflowStore {
    /** Name of the chosen workflow, or null while the picker is showing. */
    workflow: string | null;
    select: (name: string | null) => void;
}

export const useSimpleWorkflowStore = create<SimpleWorkflowStore>()(
    persist(
        set => ({
            workflow: null,
            select: name => set({ workflow: name })
        }),
        {
            name: 'swarm-ui-simple-workflow',
            storage: createJSONStorage(() => localStorage),
            partialize: state => ({ workflow: state.workflow })
        }
    )
);

/** How far the chosen workflow has got towards standing in the parameter panel. */
export interface SimpleWorkflowSession {
    loading: boolean;
    /** Why the workflow could not be opened - a deleted one, most often. */
    error: string | null;
}

/** Keeps the parameter panel in step with the Simple workspace's chosen workflow, for as long as
 *  that workspace is the one on screen.
 *
 * `active` is what scopes it: the workflow is installed when the workspace opens and taken back out
 * when it closes, so a Simple workflow never turns up unannounced in the standard panel. A graph
 * the user carried over from the Comfy editor is left alone - it is theirs, not this workspace's.
 */
export function useSimpleWorkflowSession(active: boolean): SimpleWorkflowSession {
    const workflow = useSimpleWorkflowStore(s => s.workflow);
    const open = useOpenSavedWorkflow('simple');
    const [state, setState] = useState<SimpleWorkflowSession>({ loading: false, error: null });

    useEffect(() => {
        if (!active || !workflow) {
            return;
        }
        const store = useComfyWorkflowStore.getState();
        // Already installed: reopening it would throw away everything typed into it since.
        if (store.active && store.source === 'simple' && store.name === workflow) {
            return;
        }
        let cancelled = false;
        setState({ loading: true, error: null });
        open(workflow).then(
            () => !cancelled && setState({ loading: false, error: null }),
            (e: unknown) =>
                !cancelled && setState({ loading: false, error: e instanceof Error ? e.message : String(e) })
        );
        return () => {
            cancelled = true;
        };
    }, [active, workflow, open]);

    useEffect(() => {
        if (!active) {
            return;
        }
        return () => {
            const store = useComfyWorkflowStore.getState();
            if (store.source === 'simple') {
                store.clear();
            }
        };
    }, [active]);

    return state;
}
