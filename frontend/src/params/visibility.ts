/** Which parameters and groups are currently visible.
 *
 * A param shows when all of the following hold:
 *   - its `feature_flag`s are all supported by the connected backends
 *   - `visible` is set (VisibleNormally)
 *   - the text filter matches its id, name, description or group name
 *   - it isn't advanced-and-hidden (advanced params still show once altered)
 *   - if `depend_non_default` is set, the named param is itself non-default
 *   - it isn't `suppressed` by a part of the UI that supplies it directly
 *   - it isn't a resolution control the aspect ratio makes moot: width and height show only at a
 *     Custom ratio, side length only at a named one (resTrick, params.js:603)
 */

import type { ParamSchema } from '@/api/types';
import type { GroupNode, NormalizedSchema } from './schema';
import { isAltered, valueOf, type ParamValue } from './store';

export type FilterMode = 'basic' | 'modified' | 'advanced';

export interface VisibilityInput {
    schema: NormalizedSchema;
    values: Record<string, ParamValue>;
    toggles: Record<string, boolean>;
    groupToggles: Record<string, boolean>;
    /** Feature flags the connected backends report, from GetCurrentStatus. */
    supportedFeatures: string[];
    search: string;
    mode: FilterMode;
    /** Params some other part of the UI is currently supplying, and which the panel therefore
     *  must not offer - the image editor owns `initimage` and `maskimage` while it is open. */
    suppressed?: ReadonlySet<string>;
}

export interface VisibilityResult {
    visible: Set<string>;
    /** Params hidden solely because their feature flag is unsupported; shown greyed out. */
    unsupported: Set<string>;
    altered: Set<string>;
    /** Per-group count of altered descendants, for the group header badge. */
    alteredCountByGroup: Map<string, number>;
    /** Groups with at least one visible descendant param. */
    visibleGroups: Set<string>;
    /** How many advanced params are currently hidden, for the "Advanced (n)" chip. */
    advancedHiddenCount: number;
}

/** Whether every feature flag the param needs is offered by a connected backend. */
export function isSupported(param: ParamSchema, supportedFeatures: string[]): boolean {
    if (!param.feature_flag) {
        return true;
    }
    return param.feature_flag.split(',').every(flag => supportedFeatures.includes(flag.trim()));
}

/** A param counts as advanced if it says so, or if its group does. */
function isAdvanced(param: ParamSchema, schema: NormalizedSchema): boolean {
    if (param.advanced) {
        return true;
    }
    const group = param.group ? schema.groupsById.get(param.group) : undefined;
    return group?.advanced ?? false;
}

function matchesSearch(param: ParamSchema, schema: NormalizedSchema, query: string): boolean {
    if (!query) {
        return true;
    }
    const group = param.group ? schema.groupsById.get(param.group) : undefined;
    const haystack = `${param.id} ${param.name} ${param.description} ${group?.name ?? ''}`.toLowerCase();
    return haystack.includes(query);
}

/** Whether any group above a param has a switch that is off. */
export function isGroupSwitchedOff(
    param: ParamSchema,
    schema: NormalizedSchema,
    groupToggles: Record<string, boolean>
): boolean {
    let group = param.group ? schema.groupsById.get(param.group) : undefined;
    while (group) {
        if (group.toggles && groupToggles[group.id] !== true) {
            return true;
        }
        group = group.parent ? schema.groupsById.get(group.parent) : undefined;
    }
    return false;
}

/** The params moved off their default. A switched-off group, at any level above, suppresses its
 *  descendants' altered state. */
export function computeAltered(
    schema: NormalizedSchema,
    values: Record<string, ParamValue>,
    toggles: Record<string, boolean>,
    groupToggles: Record<string, boolean>
): Set<string> {
    const altered = new Set<string>();
    for (const param of schema.params) {
        if (isAltered(param, values, toggles) && !isGroupSwitchedOff(param, schema, groupToggles)) {
            altered.add(param.id);
        }
    }
    return altered;
}

/** Which resolution controls the aspect ratio hides, or null when there is no aspect ratio on show
 *  to stand in for them. */
function aspectHides(schema: NormalizedSchema, values: Record<string, ParamValue>): Set<string> | null {
    const aspect = schema.byId.get('aspectratio');
    if (!aspect?.visible) {
        return null;
    }
    return valueOf(aspect, values) === 'Custom' ? new Set(['sidelength']) : new Set(['width', 'height']);
}

/** Everything about the store that the visibility result depends on, as one string. Lets a caller
 *  subscribe to this rather than to every value, so typing a prompt - which changes a value but
 *  rarely what is altered - does not recompute the panel. */
export function visibilitySignature(
    schema: NormalizedSchema,
    values: Record<string, ParamValue>,
    toggles: Record<string, boolean>,
    groupToggles: Record<string, boolean>
): string {
    const altered = [...computeAltered(schema, values, toggles, groupToggles)].join(',');
    const aspect = schema.byId.get('aspectratio');
    return `${altered}|${aspect ? valueOf(aspect, values) === 'Custom' : ''}`;
}

export function computeVisibility(input: VisibilityInput): VisibilityResult {
    const { schema, values, toggles, groupToggles, supportedFeatures, mode } = input;
    const query = input.search.trim().toLowerCase();

    const visible = new Set<string>();
    const unsupported = new Set<string>();
    let advancedHiddenCount = 0;

    // Pass 1: altered state, needed before visibility because advanced params stay visible once set.
    const altered = computeAltered(schema, values, toggles, groupToggles);
    const resolutionHidden = aspectHides(schema, values);

    // Pass 2: visibility.
    for (const param of schema.params) {
        const supported = isSupported(param, supportedFeatures);
        if (!supported) {
            unsupported.add(param.id);
        }
        const paramAltered = altered.has(param.id);
        const filterShow = matchesSearch(param, schema, query);
        const advanced = isAdvanced(param, schema);

        let show = supported && param.visible && filterShow && input.suppressed?.has(param.id) !== true;
        if (show && resolutionHidden?.has(param.id)) {
            show = false;
        }
        // Counts only param-level `advanced`, not group-inherited, and only those the basic view
        // would hide - an altered one shows anyway, so the "Advanced (n)" chip is not revealing it.
        if (show && param.advanced && !paramAltered) {
            advancedHiddenCount++;
        }
        if (show && advanced && mode !== 'advanced' && !paramAltered) {
            show = false;
        }
        if (show && mode === 'modified' && !paramAltered) {
            show = false;
        }
        if (show && param.depend_non_default) {
            const other = schema.byId.get(param.depend_non_default);
            if (other && !altered.has(other.id)) {
                show = false;
            }
        }
        if (show) {
            visible.add(param.id);
        }
    }

    // Pass 3: roll counts up the group tree.
    const alteredCountByGroup = new Map<string, number>();
    const visibleGroups = new Set<string>();

    function walk(node: GroupNode): { visibleCount: number; alteredCount: number } {
        let visibleCount = 0;
        let alteredCount = 0;
        for (const param of node.params) {
            if (visible.has(param.id)) {
                visibleCount++;
            }
            if (altered.has(param.id)) {
                alteredCount++;
            }
        }
        for (const child of node.children) {
            const childCounts = walk(child);
            visibleCount += childCounts.visibleCount;
            alteredCount += childCounts.alteredCount;
        }
        alteredCountByGroup.set(node.group.id, alteredCount);
        if (visibleCount > 0) {
            visibleGroups.add(node.group.id);
        }
        return { visibleCount, alteredCount };
    }
    schema.tree.forEach(walk);

    return { visible, unsupported, altered, alteredCountByGroup, visibleGroups, advancedHiddenCount };
}
