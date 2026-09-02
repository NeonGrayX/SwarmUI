/** Group-tree construction for the parameter panel.
 *
 * Its own module so that the Comfy workflow overlay, which builds a parameter set from scratch,
 * can reuse it without importing the schema normalizer that in turn calls the overlay.
 */

import type { ParamGroupSchema, ParamSchema } from '@/api/types';

export interface GroupNode {
    group: ParamGroupSchema;
    params: ParamSchema[];
    children: GroupNode[];
    /** Group ids of this node and every descendant, for aggregate counting. */
    subtreeIds: string[];
}

/** Buckets params into their groups and builds the group tree, priority-ordered at each level.
 *  Shared by the server schema and by the Comfy workflow overlay that replaces it. */
export function indexParams(
    params: ParamSchema[],
    groupsById: Map<string, ParamGroupSchema>
): { byId: Map<string, ParamSchema>; tree: GroupNode[]; ungrouped: ParamSchema[] } {
    const byId = new Map(params.map(p => [p.id, p]));

    // Bucket params by group, preserving the priority order established by the caller.
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

    return { byId, tree, ungrouped };
}
