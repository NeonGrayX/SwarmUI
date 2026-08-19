/** Pre-flight checks on a generation request.
 *
 * The backend only reports these once the request has reached a worker, and in terms of its own
 * internals - a missing model comes back as "No model input given. Did your UI load properly?"
 * (WorkflowGeneratorSteps.cs:61), which tells the user nothing about what to do. The legacy UI
 * gated the same case in front of the socket call (validateModel, generatehandler.js:358); this is
 * that gate, generalized.
 */

import type { NormalizedSchema } from '@/params/schema';

export interface GenIssue {
    message: string;
    /** Param the user has to fix, when the fix is a single param. */
    paramId?: string;
}

/** The model type a `model`-typed param picks from, eg 'Stable-Diffusion'. */
function modelSubtype(schema: NormalizedSchema | null): string {
    return schema?.byId.get('model')?.subtype ?? 'Stable-Diffusion';
}

/** The first blocking problem with a request body, or null if it looks sendable.
 *  Only checks things that are certainly wrong - anything the server may legitimately accept
 *  (an empty prompt, an unusual resolution) is left to the server. */
export function validateGenInput(
    schema: NormalizedSchema | null,
    input: Record<string, unknown>,
    images: number
): GenIssue | null {
    const model = String(input.model ?? '').trim();
    const installed = schema?.models[modelSubtype(schema)] ?? [];

    if (!model) {
        return {
            paramId: 'model',
            message:
                installed.length === 0
                    ? 'No model is installed. Download or add a model before generating.'
                    : 'No model selected. Pick one before generating.'
        };
    }
    // A model can come from reused metadata or a saved preset, so it need not exist here.
    if (installed.length > 0 && !installed.includes(model)) {
        return {
            paramId: 'model',
            message: `Model "${model}" is not on this server. Pick a model that is installed.`
        };
    }

    if (!Number.isFinite(images) || images < 1) {
        return { paramId: 'images', message: 'Images must be at least 1.' };
    }

    return null;
}
