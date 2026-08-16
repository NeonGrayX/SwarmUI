/** Normalizes the raw ListT2IParams payload into something renderable.
 *
 * Two jobs the legacy UI does imperatively across params.js and usertab.js:
 *   1. Apply the user's `param_edits` overrides on top of the server schema
 *      (see applyParamEdits, src/wwwroot/js/genpage/usertab.js:324).
 *   2. Turn the flat group list + `parent` ids into an actual tree, ordered by priority.
 */

import type { ListT2IParamsResponse, ParamGroupSchema, ParamSchema } from '@/api/types';

/** User overrides of param/group metadata, as stored by SetParamEdits. */
export interface ParamEdits {
    groups?: Record<string, Partial<ParamGroupSchema>>;
    params?: Record<string, Partial<ParamSchema> & { examples?: string }>;
}

export interface GroupNode {
    group: ParamGroupSchema;
    params: ParamSchema[];
    children: GroupNode[];
    /** Group ids of this node and every descendant, for aggregate counting. */
    subtreeIds: string[];
}

export interface NormalizedSchema {
    /** All params after edits, ordered by priority. */
    params: ParamSchema[];
    byId: Map<string, ParamSchema>;
    groupsById: Map<string, ParamGroupSchema>;
    /** Top-level group nodes, ordered by priority. */
    tree: GroupNode[];
    /** Params with no group, ordered by priority. Rendered above the groups. */
    ungrouped: ParamSchema[];
    /** Model lists keyed by model type, for `model`-typed params. */
    models: Record<string, string[]>;
}

function applyEdits<T extends object>(base: T, edits: Partial<T> | undefined): T {
    if (!edits) {
        return base;
    }
    return { ...base, ...edits };
}

export function normalizeSchema(data: ListT2IParamsResponse): NormalizedSchema {
    const edits = (data.param_edits ?? {}) as ParamEdits;

    const groupsById = new Map<string, ParamGroupSchema>();
    for (const group of data.groups) {
        groupsById.set(group.id, applyEdits(group, edits.groups?.[group.id]));
    }

    const params = data.list
        .map(param => {
            const paramEdits = edits.params?.[param.id];
            const merged = applyEdits(param, paramEdits as Partial<ParamSchema>);
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

    const byId = new Map(params.map(p => [p.id, p]));

    // Bucket params by group, preserving the priority order established above.
    const paramsByGroup = new Map<string, ParamSchema[]>();
    const ungrouped: ParamSchema[] = [];
    for (const param of params) {
        if (param.group && groupsById.has(param.group)) {
            const bucket = paramsByGroup.get(param.group);
            if (bucket) {
                bucket.push(param);
            }
            else {
                paramsByGroup.set(param.group, [param]);
            }
        }
        else {
            ungrouped.push(param);
        }
    }

    // Build the tree. Groups arrive priority-ordered from the server; keep that order at each level.
    const nodesById = new Map<string, GroupNode>();
    for (const group of groupsById.values()) {
        nodesById.set(group.id, {
            group,
            params: paramsByGroup.get(group.id) ?? [],
            children: [],
            subtreeIds: []
        });
    }
    const tree: GroupNode[] = [];
    for (const node of nodesById.values()) {
        const parent = node.group.parent ? nodesById.get(node.group.parent) : undefined;
        if (parent) {
            parent.children.push(node);
        }
        else {
            tree.push(node);
        }
    }

    const byPriority = (a: GroupNode, b: GroupNode) =>
        a.group.priority - b.group.priority || a.group.name.localeCompare(b.group.name);
    function sortAndIndex(node: GroupNode): string[] {
        node.children.sort(byPriority);
        node.subtreeIds = [node.group.id, ...node.children.flatMap(sortAndIndex)];
        return node.subtreeIds;
    }
    tree.sort(byPriority);
    tree.forEach(sortAndIndex);

    // Model dropdowns want plain name lists; the API sends [name, modelClass] pairs.
    const models: Record<string, string[]> = {};
    for (const [type, entries] of Object.entries(data.models)) {
        models[type] = entries.map(entry => entry[0]);
    }

    return { params, byId, groupsById, tree, ungrouped, models };
}

/** True if the param's default is a meaningful "on" value, used for toggle initial state. */
export function isDefaultEmpty(param: ParamSchema): boolean {
    return param.default === null || param.default === '';
}
