/** A saved workflow chosen on one screen and meant to be opened on another.
 *
 * The Library lists every saved workflow, but the two workspaces that can take one are different
 * things: Simple drives a workflow through the controls its author declared, while the Comfy
 * editor opens the graph itself to be edited. Which of the two a workflow belongs in is the
 * workflow's own business - `enable_in_simple` is its author saying it has controls worth driving -
 * so the Library reads that and says where it should land, and the Generate page carries it out.
 *
 * Deliberately not persisted: this is a hand-off between two screens, and a reload should not
 * reopen a workspace on its own.
 */

import { create } from 'zustand';

/** Which workspace a handed-over workflow is meant for. */
export type WorkflowHandoffMode = 'simple' | 'comfy';

export interface WorkflowHandoff {
    name: string;
    mode: WorkflowHandoffMode;
}

interface WorkflowHandoffStore {
    /** The workflow the Generate page has yet to open, or null when there is nothing waiting. */
    pending: WorkflowHandoff | null;
    open: (name: string, mode: WorkflowHandoffMode) => void;
    /** Claims the pending workflow, so the hand-off fires once rather than on every render. */
    take: () => void;
}

export const useWorkflowHandoffStore = create<WorkflowHandoffStore>(set => ({
    pending: null,
    open: (name, mode) => set({ pending: { name, mode } }),
    take: () => set({ pending: null })
}));
