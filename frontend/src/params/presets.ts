/** Saving the standard panel's parameters as a preset, and putting one back.
 *
 * A preset is the format Swarm already keeps parameter sets in (T2IPreset, src/Text2Image): a flat
 * `param_map` of parameter id to string value, stored in the user's own data, written by
 * AddNewPreset and listed by GetMyUserData. Writing that same shape from here means a preset saved
 * off the Generate panel is the very same object the Presets library lists and the existing
 * interface reads - there is no second format, and no server change to carry one.
 *
 * The file that import and export move is the server's own export shape, `{ "presets": [ ... ] }`
 * as ExportUserPresets returns it, so a file written here opens anywhere that speaks it.
 */

import type { ParamSchema } from '@/api/types';
import type { NormalizedSchema } from './schema';
import type { PresetEntry } from '@/library/types';
import { coerceValue, useParamStore, valueOf, type ParamValue } from './store';

/** Parameters that describe a Comfy workflow rather than a setting, and would drag an entire graph
 *  into a preset that is meant to be a handful of values. */
const EXCLUDED = new Set(['comfyworkflowraw', 'comfyworkflowparammetadata']);

/** One parameter as the save dialog offers it. */
export interface SavableParam {
    param: ParamSchema;
    /** The value as it would be stored: a preset holds strings. */
    value: string;
    /** Whether it has been moved off its default, which is what gets ticked by default. */
    altered: boolean;
    /** Name of the owning group, for the heading the dialog puts it under. */
    group: string;
}

/** A value in the flat string form a preset stores. */
export function toStoredString(value: ParamValue): string {
    if (Array.isArray(value)) {
        return value.join(',');
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return value === null ? '' : String(value);
}

/** Whether a parameter is one a preset has any business carrying.
 *
 * `do_not_save` is the server's own mark for a value that must not be tracked, and `extra_hidden`
 * covers the internal ones no panel shows. Media lists are skipped the way the existing interface
 * skips them (presets.js:290) - a preset naming half a dozen uploaded files is not portable. */
function isSavable(param: ParamSchema): boolean {
    return (
        param.visible
        && !param.do_not_save
        && !param.extra_hidden
        && !EXCLUDED.has(param.id)
        && param.type !== 'image_list'
        && param.type !== 'audio_list'
        && param.type !== 'video_list'
    );
}

/** Every parameter the panel could save right now, in the order the panel shows them. */
export function savableParams(schema: NormalizedSchema | null): SavableParam[] {
    if (!schema) {
        return [];
    }
    const { values, toggles } = useParamStore.getState();
    const out: SavableParam[] = [];
    for (const param of schema.params) {
        if (!isSavable(param)) {
            continue;
        }
        const value = toStoredString(valueOf(param, values));
        // An uploaded file lives in the browser as a data URL, which is megabytes of base64 and
        // means nothing on another machine.
        if (value.startsWith('data:')) {
            continue;
        }
        out.push({
            param,
            value,
            altered: isAlteredForPreset(param, values, toggles),
            group: (param.group ? schema.groupsById.get(param.group)?.name : null) ?? ''
        });
    }
    return out;
}

/** Whether the user has moved this parameter off its default.
 *
 * Deliberately not `isAltered` from ./store: that one treats any switched-on toggleable parameter
 * as altered even at its default value, which is right for the panel's "Modified" filter but would
 * tick a row here that carries nothing the preset needs. */
function isAlteredForPreset(
    param: ParamSchema,
    values: Record<string, ParamValue>,
    toggles: Record<string, boolean>
): boolean {
    if (param.toggleable && toggles[param.id] !== true) {
        return false;
    }
    if (!(param.id in values)) {
        return false;
    }
    return toStoredString(values[param.id]) !== toStoredString(coerceValue(param, param.default));
}

/** The `param_map` a save would write, from the rows that are ticked. */
export function paramMapFrom(items: SavableParam[], chosen: Set<string>): Record<string, string> {
    const map: Record<string, string> = {};
    for (const item of items) {
        if (chosen.has(item.param.id)) {
            map[item.param.id] = item.value;
        }
    }
    return map;
}

/** Puts a preset's parameters into the panel.
 *
 * Switching the toggles on is not a nicety: a toggleable parameter that is off, or one inside a
 * group whose master switch is off, is left out of the request entirely (buildGenInput in
 * ../generate/input.ts), so a preset that set one would write the value and then have it ignored.
 */
export function applyPresetMap(map: Record<string, unknown> | undefined, schema: NormalizedSchema | null): void {
    const store = useParamStore.getState();
    for (const [id, raw] of Object.entries(map ?? {})) {
        const text = raw === null || raw === undefined ? '' : `${raw}`;
        const param = schema?.byId.get(id);
        if (!param) {
            // A preset written on another install can name parameters this one has never heard of
            // - an extension that is not installed here. Keeping the raw value means it still
            // works if that extension turns up later, and costs nothing meanwhile.
            store.setValue(id, text);
            continue;
        }
        store.setValue(id, coerceValue(param, text));
        if (param.toggleable) {
            store.setToggle(id, true);
        }
        let group = param.group ? schema?.groupsById.get(param.group) : undefined;
        while (group) {
            if (group.toggles) {
                store.setGroupToggle(group.id, true);
            }
            group = group.parent ? schema?.groupsById.get(group.parent) : undefined;
        }
    }
}

/** Reads an exported preset file. Accepts what ExportUserPresets writes, and also a bare array or
 *  a single preset, since those are the shapes a hand-edited file tends to end up in. */
export function parsePresetFile(text: string): PresetEntry[] {
    const data: unknown = JSON.parse(text);
    const list = Array.isArray(data)
        ? data
        : (data as { presets?: unknown })?.presets ?? (data && typeof data === 'object' ? [data] : []);
    if (!Array.isArray(list)) {
        throw new Error('not-presets');
    }
    const presets = list.filter(
        (entry): entry is PresetEntry =>
            !!entry && typeof entry === 'object' && typeof (entry as PresetEntry).title === 'string'
    );
    if (presets.length === 0) {
        throw new Error('not-presets');
    }
    return presets;
}

/** The body AddNewPreset wants for one imported preset.
 *
 * The preview is only forwarded when it is already a JPEG data string. The server takes those and
 * `/Output` paths and rejects everything else outright (BasicAPIFeatures.cs:479), so passing on a
 * PNG or a `/View` path would fail the whole preset rather than just losing its thumbnail. */
export function importBody(preset: PresetEntry): Record<string, unknown> {
    const preview = typeof preset.preview_image === 'string' ? preset.preview_image : '';
    return {
        title: preset.title,
        description: preset.description ?? '',
        param_map: preset.param_map ?? {},
        ...(preview.startsWith('data:image/jpeg;base64,') ? { preview_image: preview } : {})
    };
}
