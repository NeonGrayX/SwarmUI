/** Reading a stored workflow back out of the library.
 *
 * The library keeps the graph, the rewritten API prompt and the definitions of the parameters the
 * workflow generated. Only the graph is wanted here - it is what the editor reopens - but the rest
 * of the shape is documented because the same record is what a save writes.
 */

import { api } from '@/api/client';
import type { ComfyGraph } from './bridge';

/** What ComfyReadWorkflow hands back (ComfyUIWebAPI.ReadCustomWorkflow).
 *
 * `param_values` is stored on disk but not returned, so the values of the real Swarm parameters a
 * workflow claimed are recovered from the prompt's own placeholders instead. */
export interface SavedWorkflowData {
    /** UI-format graph, as a JSON string: what the editor reopens. */
    workflow: string;
    /** API-format prompt, as a JSON string, already rewritten with `${id:default}` placeholders. */
    prompt: string;
    /** JSON string: generated parameter definitions by id, without the two carriers. */
    custom_params: string;
    image: string;
    description: string;
    enable_in_simple: boolean;
}

export async function fetchSavedWorkflow(name: string): Promise<SavedWorkflowData> {
    const data = await api.post<{ result: SavedWorkflowData }>('ComfyReadWorkflow', { name });
    return data.result;
}

/** The graph of a saved workflow, ready for the editor. */
export function savedWorkflowGraph(data: SavedWorkflowData): ComfyGraph {
    return JSON.parse(data.workflow) as ComfyGraph;
}
