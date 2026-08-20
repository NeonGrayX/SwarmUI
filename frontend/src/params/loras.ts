/** The selected LoRAs, as one editable list rather than three parallel params.
 *
 * The server takes `loras`, `loraweights` and `lorasectionconfinement` as separate equal-length
 * lists (T2IParamTypes.cs:698) and only warns-and-patches when they disagree
 * (T2IParamInput.cs:66), so anything that edits one has to edit the others in the same breath.
 * The legacy UI threads that by hand through loras.js against three DOM inputs; here it is one
 * hook, which is also what lets the picker and the context strip stay in step.
 */

import { useCallback, useMemo } from 'react';
import { useParamStore, type ParamValue } from './store';

export interface SelectedLora {
    name: string;
    /** Weight as typed. Kept as a string so a half-entered '-' or '1.' survives editing, and
     *  because the param itself is a list of strings. */
    weight: string;
    /** Section confinement id, present only when reused metadata or a preset brought one along. */
    confinement: string | null;
}

const LORAS = 'loras';
const WEIGHTS = 'loraweights';
const CONFINEMENT = 'lorasectionconfinement';

/** Params that only mean anything beside `id`, and so have to be cleared with it. Resetting the
 *  LoRA row while its weights survive would send the server a weight list with nothing to weigh. */
export function companionParams(id: string): string[] {
    return id === LORAS ? [WEIGHTS, CONFINEMENT] : [];
}

/** Weight last used for a LoRA in this session, so removing and re-adding one does not silently
 *  reset it to 1. Mirrors loraHelper.loraWeightPref (src/wwwroot/js/genpage/gentab/loras.js:29). */
const rememberedWeights = new Map<string, string>();

function stringList(value: ParamValue): string[] {
    return Array.isArray(value) ? value.map(String) : [];
}

/** Writes the three params back out, keeping them the same length. */
function write(next: SelectedLora[]): void {
    const store = useParamStore.getState();
    store.setValue(LORAS, next.map(lora => lora.name));
    store.setValue(WEIGHTS, next.map(lora => lora.weight));
    // Confinement is an internal param nothing in this UI sets directly, so it is written back only
    // when it already carries something - and then always at matching length.
    const hasConfinement = next.some(lora => lora.confinement !== null);
    if (hasConfinement) {
        store.setValue(CONFINEMENT, next.map(lora => lora.confinement ?? '0'));
    }
    else if (stringList(store.values[CONFINEMENT]).length > 0) {
        store.setValue(CONFINEMENT, []);
    }
}

/** Reads the current selection out of the param store. */
function readSelection(values: Record<string, ParamValue>): SelectedLora[] {
    const names = stringList(values[LORAS]);
    const weights = stringList(values[WEIGHTS]);
    const confinements = stringList(values[CONFINEMENT]);
    return names.map((name, index) => ({
        name,
        // A list arriving without weights (a preset, or an older saved image) is legal input the
        // server would patch to 1 anyway; showing 1 here says what will happen.
        weight: weights[index] ?? '1',
        confinement: confinements.length === names.length ? confinements[index] : null
    }));
}

export interface LoraSelection {
    selected: SelectedLora[];
    names: string[];
    /** Adds the LoRA if absent, removes it if present. */
    toggle: (name: string, defaultWeight?: number | null) => void;
    remove: (name: string) => void;
    setWeight: (name: string, weight: string) => void;
    clear: () => void;
}

export function useLoraSelection(): LoraSelection {
    const values = useParamStore(s => s.values);
    const selected = useMemo(() => readSelection(values), [values]);
    const names = useMemo(() => selected.map(lora => lora.name), [selected]);

    // Every mutation reads the store at call time rather than closing over `selected`, so two edits
    // in one tick (add, then set its weight) cannot overwrite each other.
    const toggle = useCallback((name: string, defaultWeight?: number | null) => {
        const current = readSelection(useParamStore.getState().values);
        if (current.some(lora => lora.name === name)) {
            write(current.filter(lora => lora.name !== name));
            return;
        }
        const weight = rememberedWeights.get(name) ?? String(defaultWeight ?? 1);
        write([...current, { name, weight, confinement: null }]);
    }, []);

    const remove = useCallback((name: string) => {
        const current = readSelection(useParamStore.getState().values);
        write(current.filter(lora => lora.name !== name));
    }, []);

    const setWeight = useCallback((name: string, weight: string) => {
        rememberedWeights.set(name, weight);
        const current = readSelection(useParamStore.getState().values);
        write(current.map(lora => (lora.name === name ? { ...lora, weight } : lora)));
    }, []);

    const clear = useCallback(() => write([]), []);

    return {
        selected,
        names,
        toggle,
        remove,
        setWeight,
        clear
    };
}
