/** Remembering the parameter panel across reloads.
 *
 * The existing interface keeps each parameter in a `lastparam_input_<id>` cookie that lives for the
 * `parametermemorydurationhours` user setting (getParamMemoryDays, params.js:361), with 0 meaning
 * "do not remember". This keeps the same rule in one local storage entry instead.
 *
 * Each value is stored with the parameter type it had, so a value whose parameter has since changed
 * shape - or no longer exists - is dropped rather than fed to a control that cannot read it
 * (see `pruneRestored`).
 */

import type { ParamValue } from './store';

const KEY = 'swarm-ui-params-v1';

/** The server default of `ParameterMemoryDurationHours` (src/Core/Settings.cs). */
const DEFAULT_HOURS = 6;

/** Carry the Comfy workflow graph, which is large, and which the workflow store re-seeds itself. */
export const CARRIER_PARAMS = ['comfyworkflowraw', 'comfyworkflowparammetadata'];

export interface RememberedParams {
    values: Record<string, ParamValue>;
    toggles: Record<string, boolean>;
    groupToggles: Record<string, boolean>;
    openGroups: Record<string, boolean>;
}

interface StoredParams extends RememberedParams {
    savedAt: number;
    hours: number;
    /** Param type per value id, as it was when saved. */
    types: Record<string, string>;
}

/** What the saver knows about the current schema. Fed by useParamMemory once the schema loads. */
const known = {
    hours: null as number | null,
    types: new Map<string, string>(),
    doNotSave: new Set<string>()
};

/** Ids that came back from storage, with the type each had when saved, until they have been
 *  checked against a schema. */
let unchecked: Map<string, string | undefined> | null = null;

function readStored(): StoredParams | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) {
            return null;
        }
        const data = JSON.parse(raw) as StoredParams;
        if (!data || typeof data !== 'object' || typeof data.savedAt !== 'number' || !data.values) {
            return null;
        }
        return data;
    }
    catch {
        return null;
    }
}

/** The remembered panel, or null when there is none or it has expired. */
export function loadRemembered(): RememberedParams | null {
    const data = readStored();
    if (!data) {
        return null;
    }
    const hours = typeof data.hours === 'number' ? data.hours : DEFAULT_HOURS;
    if (hours <= 0 || Date.now() - data.savedAt > hours * 3_600_000) {
        localStorage.removeItem(KEY);
        return null;
    }
    const types = data.types ?? {};
    unchecked = new Map(Object.keys(data.values).map(id => [id, types[id]]));
    return {
        values: data.values,
        toggles: data.toggles ?? {},
        groupToggles: data.groupToggles ?? {},
        openGroups: data.openGroups ?? {}
    };
}

/** A value worth writing down: not a file held inline as a data URL, which is megabytes. */
function isPortable(value: ParamValue): boolean {
    if (typeof value === 'string') {
        return !value.startsWith('data:');
    }
    if (Array.isArray(value)) {
        return !value.some(entry => entry.startsWith('data:'));
    }
    return true;
}

function write(state: RememberedParams): void {
    const hours = known.hours ?? readStored()?.hours ?? DEFAULT_HOURS;
    if (hours <= 0) {
        localStorage.removeItem(KEY);
        return;
    }
    const previousTypes = readStored()?.types ?? {};
    const values: Record<string, ParamValue> = {};
    const types: Record<string, string> = {};
    for (const [id, value] of Object.entries(state.values)) {
        if (CARRIER_PARAMS.includes(id) || known.doNotSave.has(id) || !isPortable(value)) {
            continue;
        }
        values[id] = value;
        const type = known.types.get(id) ?? previousTypes[id];
        if (type) {
            types[id] = type;
        }
    }
    const stored: StoredParams = {
        values,
        toggles: state.toggles,
        groupToggles: state.groupToggles,
        openGroups: state.openGroups,
        savedAt: Date.now(),
        hours,
        types
    };
    try {
        localStorage.setItem(KEY, JSON.stringify(stored));
    }
    catch (e) {
        console.warn('Could not remember the parameters', e);
    }
}

let pending: RememberedParams | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (pending) {
        write(pending);
        pending = null;
    }
}

/** Queues a save. Debounced, since a prompt changes on every keystroke. */
export function rememberParams(state: RememberedParams): void {
    pending = state;
    if (!timer) {
        timer = setTimeout(flush, 400);
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
}

/** Records the memory duration once the user settings arrive. 0 forgets what is stored now. */
export function setMemoryHours(hours: number): void {
    known.hours = Number.isFinite(hours) ? hours : DEFAULT_HOURS;
    if (known.hours <= 0) {
        pending = null;
        localStorage.removeItem(KEY);
    }
}

/** Records the schema's param types and `do_not_save` marks, for the next save. */
export function setKnownParams(params: { id: string; type: string; do_not_save: boolean }[]): void {
    known.types = new Map(params.map(param => [param.id, param.type]));
    known.doNotSave = new Set(params.filter(param => param.do_not_save).map(param => param.id));
}

/** The restored ids a schema does not accept: gone, or now a different type. Each id is checked
 *  once, against the first schema to arrive. */
export function pruneRestored(params: Map<string, { type: string }>): string[] {
    if (!unchecked) {
        return [];
    }
    const stale: string[] = [];
    for (const [id, type] of unchecked) {
        const param = params.get(id);
        if (!param || (type && type !== param.type)) {
            stale.push(id);
        }
    }
    unchecked = null;
    return stale;
}
