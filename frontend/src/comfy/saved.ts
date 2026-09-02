/** Reading a stored workflow back out of the library.
 *
 * The library keeps the graph, the rewritten API prompt and the definitions of the parameters the
 * workflow generated - everything a save writes. Two things are read back out of it: the graph,
 * which the Comfy editor reopens, and the parameter set, which the Simple workspace drives a
 * generation from without any editor at all.
 */

import { api } from '@/api/client';
import { cleanModelName } from '@/params/schema';
import type { ComfyGraph, ComfyPrompt } from './bridge';
import { ALWAYS_RETAIN, carrierParam, type ComfyParamDef, type ComfyWorkflowInput } from './params';

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

/** A node input that carries a number: the placeholder is wrapped so it survives a JSON number
 *  slot, and the server strips the wrapper along with the quotes (GetRawWorkflowFrom,
 *  src/BuiltinExtensions/ComfyUIBackend/ComfyUIAPIAbstractBackend.cs:800). */
const NUMERIC_PLACEHOLDER = /^%%_COMFYFIXME_(.*)_ENDFIXME_%%$/s;

/** `${id:literal}`, filling the whole of an input. The literal never contains a brace of its own:
 *  escapeLiteral (./params.ts) rewrites both to parentheses before it is written. */
const PLACEHOLDER = /^\$\{([^:}]+)(?::([^}]*))?\}$/s;

/** Rebuilds the parameter set of a saved workflow, without a Comfy editor to build it from.
 *
 * The stored `custom_params` already holds every generated parameter, so the only thing left to
 * recover is which *real* Swarm parameters the workflow claimed and what values it gave them.
 * `param_values` records exactly that on disk, but ReadCustomWorkflow does not return it - so the
 * claims are read back out of the prompt, where each one left a `${id:value}` placeholder behind.
 *
 * `knownParamIds` are the parameters the server actually registers: a placeholder naming anything
 * else is a generated parameter under a name of its own, not a claim.
 */
export function savedWorkflowInput(
    data: SavedWorkflowData,
    knownParamIds: ReadonlySet<string>
): ComfyWorkflowInput {
    const params = JSON.parse(data.custom_params) as Record<string, ComfyParamDef>;
    const prompt = JSON.parse(data.prompt) as ComfyPrompt;
    const retained = [...ALWAYS_RETAIN];
    const paramVal: Record<string, string | number | boolean> = {};

    for (const node of Object.values(prompt)) {
        for (const raw of Object.values(node.inputs ?? {})) {
            if (typeof raw !== 'string') {
                continue;
            }
            const numeric = NUMERIC_PLACEHOLDER.exec(raw);
            const match = PLACEHOLDER.exec(numeric ? numeric[1] : raw);
            if (!match) {
                continue;
            }
            // A seed-typed generated parameter is written with a `+seed` suffix its own id does
            // not carry (buildComfyParams, ./params.ts).
            const id = match[1].endsWith('+seed') ? match[1].slice(0, -'+seed'.length) : match[1];
            if (id in params || id in paramVal || !knownParamIds.has(id)) {
                continue;
            }
            if (!retained.includes(id)) {
                retained.push(id);
            }
            // `${prompt}` and friends are written without a literal: the workflow claimed the
            // parameter but had nothing of its own to put in it.
            if (match[2] !== undefined) {
                paramVal[id] = numeric ? Number(match[2]) : cleanClaimed(id, match[2]);
            }
        }
    }

    // Same closing rule as a build from the editor: a workflow that drives width and height is
    // sizing its own latent, so the two controls that would fight with it are pinned to Custom.
    if (retained.includes('width') && retained.includes('height')
        && (!retained.includes('aspectratio') || !retained.includes('sidelength'))) {
        retained.push('aspectratio', 'sidelength');
        paramVal.aspectratio = 'Custom';
    }

    // The stored strings are what the server reads the graph and its parameter types back out of,
    // so they are carried through untouched rather than re-serialized.
    params.comfyworkflowparammetadata = carrierParam('comfyworkflowparammetadata', data.custom_params);
    params.comfyworkflowraw = carrierParam('comfyworkflowraw', data.prompt);

    return { params, retained, paramVal };
}

/** The value a claimed parameter takes, given what its placeholder holds.
 *
 * Only the model needs the distinction: a checkpoint loader's placeholder keeps the raw file name
 * it had in the graph, while the picker - and so the value buildComfyParams stored beside it -
 * works in cleaned names. Reading the raw one back would leave the picker showing nothing. */
function cleanClaimed(id: string, literal: string): string {
    return id === 'model' ? cleanModelName(literal).replaceAll('\\', '/') : literal;
}
