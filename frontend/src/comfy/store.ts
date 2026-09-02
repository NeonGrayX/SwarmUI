/** The custom Comfy workflow currently standing in for the normal parameter set.
 *
 * Activating one replaces the Generate panel's parameters wholesale (see applyComfyWorkflow in
 * ./schema.ts) and pins the workflow itself into `comfyworkflowraw`, so generation runs the graph
 * the user built rather than Swarm's own. It survives a reload, which is why it is persisted -
 * the existing interface keeps `last_comfy_workflow_input` in local storage for the same reason.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useParamStore, type ParamValue } from '@/params/store';
import type { ComfyGraph } from './bridge';
import type { ComfyWorkflowInput } from './params';

/** Which part of the app put the workflow in the panel. The Simple workspace hands the panel back
 *  when it closes, and has to know the workflow standing in it is still the one it installed - a
 *  graph carried over from the Comfy editor is the user's, and stays. */
export type ComfyWorkflowSource = 'editor' | 'simple';

interface ComfyWorkflowStore {
    /** The active workflow's parameter set, or null when the normal parameters are in use. */
    active: ComfyWorkflowInput | null;
    /** Name of the saved workflow this came from, when it came from the library. */
    name: string | null;
    /** What installed the active workflow, or null when the normal parameters are in use. */
    source: ComfyWorkflowSource | null;
    /** The graph behind the active workflow, when it is at hand: what saving it to the library
     *  writes. Deliberately left out of storage - a graph is large, and a workflow that outlives a
     *  reload can be fetched back by name if it has one. */
    graph: ComfyGraph | null;
    /** Installs a workflow and seeds the param store with the values it brings. */
    activate: (
        input: ComfyWorkflowInput,
        name?: string | null,
        graph?: ComfyGraph | null,
        source?: ComfyWorkflowSource
    ) => void;
    /** Returns the panel to Swarm's own parameters. */
    clear: () => void;
}

/** Values a workflow contributes to the param store: what it claimed from the real parameters,
 *  plus the two carriers the server reads the graph itself out of. */
function seedValues(input: ComfyWorkflowInput): Record<string, ParamValue> {
    const values: Record<string, ParamValue> = { ...input.paramVal };
    for (const id of ['comfyworkflowraw', 'comfyworkflowparammetadata']) {
        const param = input.params[id];
        if (param) {
            values[id] = `${param.default}`;
        }
    }
    return values;
}

/** Local storage, but a full quota is not a reason to refuse the workflow: a large graph can
 *  exceed the 5MB budget, and losing it on the next reload beats losing it now. The existing
 *  interface swallows the same failure (comfy_workflow_editor_helper.js:1124). */
const tolerantStorage: Storage = {
    get length() {
        return localStorage.length;
    },
    key: index => localStorage.key(index),
    getItem: key => localStorage.getItem(key),
    removeItem: key => localStorage.removeItem(key),
    clear: () => localStorage.clear(),
    setItem(key, value) {
        try {
            localStorage.setItem(key, value);
        }
        catch (e) {
            console.warn('Could not persist the Comfy workflow', e);
        }
    }
};

export const useComfyWorkflowStore = create<ComfyWorkflowStore>()(
    persist(
        (set, get) => ({
            active: null,
            name: null,
            source: null,
            graph: null,

            activate: (input, name = null, graph = null, source = 'editor') => {
                const previous = get().active;
                // Parameter ids are derived from node ids and titles, so a different workflow
                // means different ids - anything left over from the last one is dead weight that
                // would still be sent with the next generation.
                const stale = previous ? Object.keys(previous.params) : [];
                useParamStore.getState().applyBundle(stale, seedValues(input));
                set({ active: input, name, source, graph });
            },

            clear: () => {
                const previous = get().active;
                useParamStore.getState().applyBundle(previous ? Object.keys(previous.params) : [], {});
                set({ active: null, name: null, source: null, graph: null });
            }
        }),
        {
            name: 'swarm-ui-comfy-workflow',
            storage: createJSONStorage(() => tolerantStorage),
            // The param store is deliberately not persisted, so a reload leaves the panel empty.
            // Seeding it again here is what keeps `comfyworkflowraw` attached to the next
            // generation - without it the panel would show the workflow but not run it.
            onRehydrateStorage: () => state => {
                if (state?.active) {
                    useParamStore.getState().applyBundle([], seedValues(state.active));
                }
            },
            // The actions are rebuilt on every load; only the workflow itself is worth storing.
            partialize: state => ({ active: state.active, name: state.name, source: state.source })
        }
    )
);
