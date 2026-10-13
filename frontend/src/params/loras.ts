/** The selected LoRAs, as one editable list rather than four parallel params.
 *
 * The server takes `loras`, `loraweights`, `loratencweights` and `lorasectionconfinement` as
 * separate equal-length lists (T2IParamTypes.cs:698) and only warns-and-patches when they disagree
 * (T2IParamInput.cs:66), so anything that edits one has to edit the others in the same breath.
 * One hook owns all four, which is what keeps the picker and the context strip in step.
 *
 * Entries are addressed by position, not by name: the same LoRA can legitimately appear twice -
 * once globally and once confined to a segment - and a name lookup would edit the wrong one.
 */

import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useParamStore, type ParamValue } from './store';

export interface SelectedLora {
    name: string;
    /** Weight as typed. Kept as a string so a half-entered '-' or '1.' survives editing, and
     *  because the param itself is a list of strings. */
    weight: string;
    /** Text encoder weight, present only when reused metadata or a preset brought one along. */
    tencWeight: string | null;
    /** Section confinement id, present only when reused metadata or a preset brought one along. */
    confinement: string | null;
}

const LORAS = 'loras';
const WEIGHTS = 'loraweights';
const TENC_WEIGHTS = 'loratencweights';
const CONFINEMENT = 'lorasectionconfinement';

/** The lists that ride alongside `loras`, one entry per LoRA. */
export const LORA_COMPANIONS = [WEIGHTS, TENC_WEIGHTS, CONFINEMENT];

/** Params that only mean anything beside `id`, and so have to be cleared with it. Resetting the
 *  LoRA row while its weights survive would send the server a weight list with nothing to weigh. */
export function companionParams(id: string): string[] {
    return id === LORAS ? LORA_COMPANIONS : [];
}

/** Weight last used for a LoRA in this session, so removing and re-adding one does not silently
 *  reset it to 1. Mirrors loraHelper.loraWeightPref (src/wwwroot/js/genpage/gentab/loras.js:29). */
const rememberedWeights = new Map<string, string>();

function stringList(value: ParamValue | undefined): string[] {
    return Array.isArray(value) ? value.map(String) : [];
}

/** The four lists for a selection, all the same length. The optional ones are written only when
 *  some entry carries something - and then a missing entry is filled with what it means anyway:
 *  global confinement, and a text encoder weight equal to the LoRA's own. */
export function loraLists(next: SelectedLora[], current: Record<string, ParamValue>): Record<string, ParamValue> {
    const lists: Record<string, ParamValue> = {
        [LORAS]: next.map(lora => lora.name),
        [WEIGHTS]: next.map(lora => lora.weight)
    };
    if (next.some(lora => lora.tencWeight !== null)) {
        lists[TENC_WEIGHTS] = next.map(lora => lora.tencWeight ?? lora.weight);
    }
    else if (stringList(current[TENC_WEIGHTS]).length > 0) {
        lists[TENC_WEIGHTS] = [];
    }
    if (next.some(lora => lora.confinement !== null)) {
        lists[CONFINEMENT] = next.map(lora => lora.confinement ?? '0');
    }
    else if (stringList(current[CONFINEMENT]).length > 0) {
        lists[CONFINEMENT] = [];
    }
    return lists;
}

/** Writes the lists back out in one store update, keeping them the same length. */
export function writeLoras(next: SelectedLora[]): void {
    useParamStore.setState(s => ({ values: { ...s.values, ...loraLists(next, s.values) } }));
}

/** Reads the current selection out of the param store. */
export function readLoras(values: Record<string, ParamValue | undefined>): SelectedLora[] {
    const names = stringList(values[LORAS]);
    const weights = stringList(values[WEIGHTS]);
    const tencWeights = stringList(values[TENC_WEIGHTS]);
    const confinements = stringList(values[CONFINEMENT]);
    return names.map((name, index) => ({
        name,
        // A list arriving without weights (a preset, or an older saved image) is legal input the
        // server would patch to 1 anyway; showing 1 here says what will happen.
        weight: weights[index] ?? '1',
        tencWeight: tencWeights.length === names.length ? tencWeights[index] : null,
        confinement: confinements.length === names.length ? confinements[index] : null
    }));
}

export interface LoraSelection {
    selected: SelectedLora[];
    names: string[];
    /** Adds the LoRA if absent, removes every entry of it if present. */
    toggle: (name: string, defaultWeight?: number | null) => void;
    /** Removes the entry at `index`. */
    remove: (index: number) => void;
    /** Sets the weight of the entry at `index`. */
    setWeight: (index: number, weight: string) => void;
    clear: () => void;
}

export function useLoraSelection(): LoraSelection {
    // Only the four lists, so typing elsewhere in the panel does not re-render the picker.
    const [loras, weights, tencWeights, confinements] = useParamStore(
        useShallow(s => [s.values[LORAS], s.values[WEIGHTS], s.values[TENC_WEIGHTS], s.values[CONFINEMENT]])
    );
    const selected = useMemo(
        () =>
            readLoras({
                [LORAS]: loras,
                [WEIGHTS]: weights,
                [TENC_WEIGHTS]: tencWeights,
                [CONFINEMENT]: confinements
            }),
        [loras, weights, tencWeights, confinements]
    );
    const names = useMemo(() => selected.map(lora => lora.name), [selected]);

    // Every mutation reads the store at call time rather than closing over `selected`, so two edits
    // in one tick (add, then set its weight) cannot overwrite each other.
    const toggle = useCallback((name: string, defaultWeight?: number | null) => {
        const current = readLoras(useParamStore.getState().values);
        if (current.some(lora => lora.name === name)) {
            writeLoras(current.filter(lora => lora.name !== name));
            return;
        }
        const weight = rememberedWeights.get(name) ?? String(defaultWeight ?? 1);
        writeLoras([...current, { name, weight, tencWeight: null, confinement: null }]);
    }, []);

    const remove = useCallback((index: number) => {
        const current = readLoras(useParamStore.getState().values);
        writeLoras(current.filter((_, i) => i !== index));
    }, []);

    const setWeight = useCallback((index: number, weight: string) => {
        const current = readLoras(useParamStore.getState().values);
        if (!current[index]) {
            return;
        }
        rememberedWeights.set(current[index].name, weight);
        writeLoras(current.map((lora, i) => (i === index ? { ...lora, weight } : lora)));
    }, []);

    const clear = useCallback(() => writeLoras([]), []);

    return {
        selected,
        names,
        toggle,
        remove,
        setWeight,
        clear
    };
}
