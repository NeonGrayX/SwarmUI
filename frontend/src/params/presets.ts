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
import { LORA_COMPANIONS, loraLists, readLoras } from './loras';
import { CARRIER_PARAMS } from './memory';
import { coerceValue, useParamStore, valueOf, type ParamValue } from './store';
import { isGroupSwitchedOff } from './visibility';

/** Parameters that describe a Comfy workflow rather than a setting, and would drag an entire graph
 *  into a preset that is meant to be a handful of values. */
const EXCLUDED = new Set(CARRIER_PARAMS);

/** A preset title as the existing interface stores it (save_new_preset, presets.js:267): trimmed,
 *  forward slashes only, no leading slash. Slashes are folders. */
export function cleanPresetTitle(raw: string): string {
    return raw.trim().replaceAll('\\', '/').replace(/^\/+/, '');
}

/** Whether a cleaned title names a folder rather than a preset, which the server cannot save. */
export function isFolderTitle(title: string): boolean {
    return title.endsWith('/');
}

/** One parameter as the save dialog offers it. */
export interface SavableParam {
    param: ParamSchema;
    /** The value as it would be stored: a preset holds strings. */
    value: string;
    /** Whether it has been moved off its default, which is what gets ticked by default. */
    altered: boolean;
    /** Name of the owning group, for the heading the dialog puts it under. */
    group: string;
    /** Values that travel with this one: the LoRA weight lists ride along with `loras`, since a
     *  LoRA list without its weights comes back at full strength. */
    companions?: Record<string, string>;
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
    const { values, toggles, groupToggles } = useParamStore.getState();
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
            // A value inside a switched-off group is not in use, however far it is from default.
            altered: isAlteredForPreset(param, values, toggles) && !isGroupSwitchedOff(param, schema, groupToggles),
            group: (param.group ? schema.groupsById.get(param.group)?.name : null) ?? '',
            companions: param.id === 'loras' ? loraCompanions(values) : undefined
        });
    }
    return out;
}

/** The non-empty LoRA side lists, as stored strings. */
function loraCompanions(values: Record<string, ParamValue>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of LORA_COMPANIONS) {
        const text = id in values ? toStoredString(values[id]) : '';
        if (text) {
            out[id] = text;
        }
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
            Object.assign(map, item.companions);
        }
    }
    return map;
}

/** The prompt syntax that confines what follows it to part of the image. A preset's text goes in
 *  front of these, not after them, or it would only apply inside the last region. */
const SECTION_TAGS = ['<segment:', '<object:', '<region:'];

/** A preset value with `{value}` replaced by what the param holds now - "masterpiece, {value}"
 *  wraps the prompt rather than replacing it. Mirrors applyOnePreset (presets.js:442). */
function substituteValue(template: string, current: string): string {
    const low = current.toLowerCase();
    const cuts = SECTION_TAGS.map(tag => low.indexOf(tag)).filter(index => index !== -1);
    if (cuts.length === 0) {
        return template.replace('{value}', () => current);
    }
    const end = Math.min(...cuts);
    return `${template.replace('{value}', () => current.slice(0, end).trim())} ${current.slice(end).trim()}`;
}

/** Splits a stored list the way coerceValue does. */
function storedList(raw: unknown): string[] {
    const text = raw === null || raw === undefined ? '' : `${raw}`;
    return text.split(',').map(entry => entry.trim()).filter(Boolean);
}

/** Adds a preset's LoRAs to the ones already selected, as the existing interface appends rather
 *  than replaces (presets.js:458). A LoRA already in the list takes the preset's weights instead
 *  of being added twice. All four lists stay aligned in the one write. */
function appendPresetLoras(map: Record<string, unknown>): void {
    const names = storedList(map.loras);
    const weights = storedList(map.loraweights);
    const tencWeights = storedList(map.loratencweights);
    const confinements = storedList(map.lorasectionconfinement);
    useParamStore.setState(s => {
        const next = readLoras(s.values);
        names.forEach((name, index) => {
            const entry = {
                name,
                weight: weights[index] ?? '1',
                tencWeight: tencWeights.length === names.length ? tencWeights[index] : null,
                confinement: confinements.length === names.length ? confinements[index] : null
            };
            // Duplicate names are legitimate when confined to different prompt sections, so only an
            // entry with the same confinement counts as the one this preset is updating.
            const confinedTo = entry.confinement ?? '0';
            const existing = next.findIndex(lora => lora.name === name && (lora.confinement ?? '0') === confinedTo);
            if (existing === -1) {
                next.push(entry);
            }
            else {
                next[existing] = entry;
            }
        });
        return { values: { ...s.values, ...loraLists(next, s.values) } };
    });
}

/** Switches on a param's own toggle and every group toggle above it. */
function switchOn(param: ParamSchema, schema: NormalizedSchema | null): void {
    const store = useParamStore.getState();
    if (param.toggleable) {
        store.setToggle(param.id, true);
    }
    let group = param.group ? schema?.groupsById.get(param.group) : undefined;
    while (group) {
        if (group.toggles) {
            store.setGroupToggle(group.id, true);
        }
        group = group.parent ? schema?.groupsById.get(group.parent) : undefined;
    }
}

/** Puts a preset's parameters into the panel.
 *
 * Switching the toggles on is not a nicety: a toggleable parameter that is off, or one inside a
 * group whose master switch is off, is left out of the request entirely (buildGenInput in
 * ../generate/input.ts), so a preset that set one would write the value and then have it ignored.
 */
export function applyPresetMap(map: Record<string, unknown> | undefined, schema: NormalizedSchema | null): void {
    const entries = map ?? {};
    const store = useParamStore.getState();
    const hasLoras = 'loras' in entries;
    if (hasLoras) {
        appendPresetLoras(entries);
        const param = schema?.byId.get('loras');
        if (param) {
            switchOn(param, schema);
        }
    }
    for (const [id, raw] of Object.entries(entries)) {
        if (hasLoras && (id === 'loras' || LORA_COMPANIONS.includes(id))) {
            continue;
        }
        let text = raw === null || raw === undefined ? '' : `${raw}`;
        const param = schema?.byId.get(id);
        if (!param) {
            // A preset written on another install can name parameters this one has never heard of
            // - an extension that is not installed here. Keeping the raw value means it still
            // works if that extension turns up later, and costs nothing meanwhile.
            store.setValue(id, text);
            continue;
        }
        if (text.includes('{value}')) {
            text = substituteValue(text, toStoredString(valueOf(param, useParamStore.getState().values)));
        }
        store.setValue(id, coerceValue(param, text));
        switchOn(param, schema);
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
        title: cleanPresetTitle(preset.title),
        description: preset.description ?? '',
        param_map: preset.param_map ?? {},
        ...(preview.startsWith('data:image/jpeg;base64,') ? { preview_image: preview } : {})
    };
}
