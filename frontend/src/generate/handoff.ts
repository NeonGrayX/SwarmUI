/** The workspace the Generate page should open in, chosen on another screen.
 *
 * The Generate page is one destination with three workspaces behind it - standard parameters, a
 * saved workflow's own controls (Simple), and the Comfy editor - and which one is on screen is the
 * page's own state. A screen outside it that means to send the user to a particular one therefore
 * cannot just navigate: it leaves the choice here, and the Generate page carries it out on arrival.
 *
 * Two kinds of hand-off go through it. A workflow chosen in the Library names the workspace that
 * can drive it - `enable_in_simple` is its author saying it has controls worth driving, and one
 * without them belongs in the editor, where the graph is the point. A preset names no workflow at
 * all: its parameters are the standard set's, so the standard workspace is the whole request.
 *
 * Deliberately not persisted: this is a hand-off between two screens, and a reload should not
 * reopen a workspace on its own.
 */

import { create } from 'zustand';

/** Which of the Generate page's workspaces is meant to be on screen. */
export type WorkspaceMode = 'standard' | 'comfy' | 'simple';

/** The workspaces a saved workflow can be handed to. */
export type WorkflowHandoffMode = Exclude<WorkspaceMode, 'standard'>;

export interface WorkspaceHandoff {
    mode: WorkspaceMode;
    /** The saved workflow to open with it, or null when the workspace itself is the request. */
    workflow: string | null;
}

interface WorkspaceHandoffStore {
    /** What the Generate page has yet to open, or null when there is nothing waiting. */
    pending: WorkspaceHandoff | null;
    /** Sends a saved workflow to the workspace that can drive it. */
    openWorkflow: (name: string, mode: WorkflowHandoffMode) => void;
    /** Asks for a workspace on its own, for a hand-off that is about where the user lands. */
    openWorkspace: (mode: WorkspaceMode) => void;
    /** Claims the pending hand-off, so it fires once rather than on every render. */
    take: () => void;
}

export const useWorkspaceHandoffStore = create<WorkspaceHandoffStore>(set => ({
    pending: null,
    openWorkflow: (name, mode) => set({ pending: { mode, workflow: name } }),
    openWorkspace: mode => set({ pending: { mode, workflow: null } }),
    take: () => set({ pending: null })
}));
