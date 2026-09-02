/** Normalizes the raw ListT2IParams payload into something renderable. Two jobs:
 *   1. Apply the user's `param_edits` overrides on top of the server schema.
 *   2. Turn the flat group list + `parent` ids into an actual tree, ordered by priority (./tree).
 */

import { useMemo } from 'react';
import { useSession, useT2IParams } from '@/api/hooks';
import { applyComfyWorkflow } from '@/comfy/schema';
import { useComfyWorkflowStore } from '@/comfy/store';
import type {
    ListT2IParamsResponse,
    ModelClassInfo,
    ModelCompatClassInfo,
    ParamGroupSchema,
    ParamSchema
} from '@/api/types';
import { indexParams, type GroupNode } from './tree';

export type { GroupNode } from './tree';

/** User overrides of param/group metadata, as stored by SetParamEdits. */
export interface ParamEdits {
    groups?: Record<string, Partial<ParamGroupSchema>>;
    params?: Record<string, Partial<ParamSchema> & { examples?: string }>;
}

export interface NormalizedSchema {
    /** All params after edits, ordered by priority. */
    params: ParamSchema[];
    byId: Map<string, ParamSchema>;
    groupsById: Map<string, ParamGroupSchema>;
    /** Params and groups as they shipped, before the user's `param_edits`. This is what the
     *  Parameter Configuration reset controls restore to, and what tells a redefined `default`
     *  apart from the server's own. */
    originals: Map<string, ParamSchema>;
    originalGroups: Map<string, ParamGroupSchema>;
    /** Top-level group nodes, ordered by priority. */
    tree: GroupNode[];
    /** Params with no group, ordered by priority. Rendered above the groups. */
    ungrouped: ParamSchema[];
    /** Model lists keyed by model type, for `model`-typed params. */
    models: Record<string, string[]>;
    /** Architecture (model class) id per model, keyed by model type then cleaned model name.
     *  Null where the server could not classify the file. */
    modelArch: Record<string, Record<string, string | null>>;
    /** Every architecture the server knows, keyed by id. */
    modelClasses: Record<string, ModelClassInfo>;
    /** Every compatibility family the server knows, keyed by id. */
    compatClasses: Record<string, ModelCompatClassInfo>;
}

/** Params the server marks invisible because it expects a UI to give them a bespoke home, but
 *  which this UI renders as ordinary rows.
 *
 * `model` is registered ungrouped and `VisibleNormally: false` (T2IParamTypes.cs:689). Leaving it
 * out here would let it count towards the Modified filter without ever appearing in it, so it is
 * placed in Core Parameters, above Images (priority -50). User `param_edits` still win over this. */
const PANEL_PLACEMENT: Record<string, Partial<ParamSchema>> = {
    model: { visible: true, group: 'coreparameters', priority: -60 },
    // LoRAs are hidden the same way (T2IParamTypes.cs:698). They get a real picker here, placed
    // directly under the model they attach to - and not as `advanced`, since choosing a LoRA is
    // ordinary work, not an expert setting.
    loras: { visible: true, advanced: false, group: 'coreparameters', priority: -55 }
};

function applyEdits<T extends object>(base: T, edits: Partial<T> | undefined): T {
    if (!edits) {
        return base;
    }
    return { ...base, ...edits };
}

export function normalizeSchema(data: ListT2IParamsResponse): NormalizedSchema {
    const edits = (data.param_edits ?? {}) as ParamEdits;

    const groupsById = new Map<string, ParamGroupSchema>();
    const originalGroups = new Map<string, ParamGroupSchema>();
    for (const group of data.groups) {
        groupsById.set(group.id, applyEdits(group, edits.groups?.[group.id]));
        originalGroups.set(group.id, group);
    }

    // PANEL_PLACEMENT counts as shipped state: it is this UI's own placement, not a user edit, so
    // resetting a parameter puts it back here rather than back to the server's own default.
    const originals = new Map<string, ParamSchema>();
    const params = data.list
        .map(param => {
            const paramEdits = edits.params?.[param.id];
            const placed = applyEdits(param, PANEL_PLACEMENT[param.id]);
            originals.set(param.id, placed);
            const merged = applyEdits(placed, paramEdits as Partial<ParamSchema>);
            // `examples` is stored as a '||'-separated string in edits but is an array in the schema.
            if (paramEdits && typeof paramEdits.examples === 'string') {
                merged.examples = paramEdits.examples
                    .split('||')
                    .map(s => s.trim())
                    .filter(Boolean);
            }
            return merged;
        })
        .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

    const { byId, tree, ungrouped } = indexParams(params, groupsById);

    // Model dropdowns want plain name lists; the API sends [name, modelClass] pairs. The class id
    // half is kept beside it, because it is what the compatibility rules in the pickers read.
    const models: Record<string, string[]> = {};
    const modelArch: Record<string, Record<string, string | null>> = {};
    for (const [type, entries] of Object.entries(data.models)) {
        const names: string[] = [];
        const arch: Record<string, string | null> = {};
        for (const entry of entries) {
            const name = cleanModelName(entry[0]);
            names.push(name);
            arch[name] = entry[1];
        }
        models[type] = names;
        modelArch[type] = arch;
    }

    return {
        params,
        byId,
        groupsById,
        originals,
        originalGroups,
        tree,
        ungrouped,
        models,
        modelArch,
        modelClasses: data.model_classes ?? {},
        compatClasses: data.model_compat_classes ?? {}
    };
}

/** The normalized schema for the current session, or null until it has loaded. Shared by the
 *  param panel and by everything that needs to look a param up by id.
 *
 * A custom Comfy workflow replaces the parameter set here rather than in the panel, so that the
 * request builder, the metadata reader and the pickers all agree on what a parameter is. */
export function useParamSchema(): NormalizedSchema | null {
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const workflow = useComfyWorkflowStore(s => s.active);
    return useMemo(() => {
        if (!params.data) {
            return null;
        }
        const base = normalizeSchema(params.data);
        return workflow ? applyComfyWorkflow(base, workflow) : base;
    }, [params.data, workflow]);
}

/** A model's name as everything except the raw file list spells it: without `.safetensors`.
 *
 * The server hands `models` down as bare file names, but writes the cleaned form into image
 * metadata (CleanModelName, src/Text2Image/T2IParamTypes.cs:304) and into the `values` of the model
 * params that carry their own list (CleanModelList, :378). Cleaning here is what lets a reused
 * image's `model` match an entry in the dropdown; the server resolves either form (T2IModelHandler
 * .GetModel, :242). */
export function cleanModelName(name: string): string {
    return name.endsWith('.safetensors') ? name.slice(0, -'.safetensors'.length) : name;
}

/** True if the param's default is a meaningful "on" value, used for toggle initial state. */
export function isDefaultEmpty(param: ParamSchema): boolean {
    return param.default === null || param.default === '';
}
