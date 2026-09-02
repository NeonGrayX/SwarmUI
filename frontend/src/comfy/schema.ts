/** Swaps the Generate panel's parameter set for the one a Comfy workflow defines.
 *
 * The result is the same `NormalizedSchema` the server schema produces, so nothing downstream
 * needs to know a workflow is in play. It holds:
 *   - one generated parameter per literal input of the workflow, grouped by node
 *   - the real Swarm parameters the workflow claimed (the prompt, the model, the seed...), with
 *     the workflow's own values as their defaults
 *   - the parameters marked `always_retain`, which apply to any generation at all
 *
 * Mirrors sortAndFixComfyParameters in the existing interface
 * (src/BuiltinExtensions/ComfyUIBackend/Assets/comfy_workflow_editor_helper.js:1068).
 */

import type { ParamDataType, ParamGroupSchema, ParamSchema, ParamViewType } from '@/api/types';
import type { NormalizedSchema } from '@/params/schema';
import { indexParams } from '@/params/tree';
import type { ComfyParamDef, ComfyWorkflowInput } from './params';

/** Group the generated parameters sit under when the workflow gave them no group of its own. */
const UNGROUPED_ID = 'ungrouped';

/** Fills a generated parameter definition out into the full schema shape the UI renders. */
function toParamSchema(def: ComfyParamDef): ParamSchema {
    return {
        name: def.name,
        id: def.id,
        description: def.description ?? '',
        type: def.type as ParamDataType,
        subtype: def.subtype ?? null,
        default: def.default === null || def.default === undefined ? null : `${def.default}`,
        min: def.min ?? 0,
        max: def.max ?? 0,
        view_min: 0,
        view_max: def.view_max ?? 0,
        step: def.step ?? 1,
        values: def.values ?? null,
        value_names: null,
        examples: null,
        visible: def.visible,
        advanced: def.advanced,
        // Generated parameters only exist because a Comfy backend is connected, but gating them on
        // the flag as well would hide the whole panel during a backend restart.
        feature_flag: null,
        toggleable: false,
        priority: def.priority,
        group: def.group ? def.group.id : null,
        always_retain: false,
        do_not_save: def.do_not_save,
        do_not_preview: false,
        view_type: (def.view_type ?? 'normal') as ParamViewType,
        extra_hidden: def.extra_hidden ?? false,
        can_sectionalize: false,
        nonreusable: false,
        depend_non_default: null
    };
}

function toGroupSchema(def: NonNullable<ComfyParamDef['group']>): ParamGroupSchema {
    return {
        name: def.name,
        id: def.id,
        toggles: def.toggles,
        open: def.open,
        priority: def.priority,
        description: '',
        advanced: def.advanced,
        can_shrink: def.can_shrink,
        parent: null
    };
}

export function applyComfyWorkflow(base: NormalizedSchema, input: ComfyWorkflowInput): NormalizedSchema {
    const retained = new Set(input.retained);

    // Generated parameters first, so a workflow that reuses a real parameter id keeps the real one.
    const groupsById = new Map<string, ParamGroupSchema>();
    const generated: ParamSchema[] = [];
    for (const def of Object.values(input.params)) {
        if (retained.has(def.id)) {
            continue;
        }
        if (def.group && !groupsById.has(def.group.id)) {
            groupsById.set(def.group.id, toGroupSchema(def.group));
        }
        generated.push(toParamSchema(def));
    }
    // Parameters a `SwarmInput` node declared without a group of its own still need somewhere to
    // live, and the workflow author named it: 'Ungrouped'.
    if (generated.some(p => p.group === UNGROUPED_ID) && !groupsById.has(UNGROUPED_ID)) {
        groupsById.set(UNGROUPED_ID, {
            name: 'Ungrouped', id: UNGROUPED_ID, toggles: false, open: true,
            priority: 0, description: '', advanced: false, can_shrink: false, parent: null
        });
    }

    // Then the real parameters the workflow kept, carrying the values it supplied as their
    // defaults - that is what makes the panel show what the graph actually contains.
    const kept: ParamSchema[] = [];
    for (const param of base.params) {
        if (!retained.has(param.id) && !param.always_retain) {
            continue;
        }
        const value = input.paramVal[param.id];
        kept.push(value === undefined ? param : { ...param, default: `${value}` });
        for (const group of groupChain(base, param.group)) {
            groupsById.set(group.id, group);
        }
    }

    const params = [...kept, ...generated].sort(
        (a, b) => a.priority - b.priority || a.name.localeCompare(b.name)
    );
    const { byId, tree, ungrouped } = indexParams(params, groupsById);

    return { ...base, params, byId, groupsById, tree, ungrouped };
}

/** A group and every group above it, so a kept parameter's whole ancestry comes along. */
function groupChain(base: NormalizedSchema, groupId: string | null): ParamGroupSchema[] {
    const chain: ParamGroupSchema[] = [];
    let group = groupId ? base.groupsById.get(groupId) : undefined;
    while (group && !chain.some(g => g.id === group?.id)) {
        chain.push(group);
        group = group.parent ? base.groupsById.get(group.parent) : undefined;
    }
    return chain;
}
