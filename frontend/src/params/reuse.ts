/** "Reuse parameters" - loading the parameters recorded in an image back into the generation form.
 *
 * Three facts about the metadata format shape most of this:
 *   - `original_prompt` / `original_negativeprompt` are what the user typed, so they win over the
 *     post-wildcard prompt that was actually generated with,
 *   - LoRAs injected by `<lora:...>` syntax in the prompt are already in the prompt; re-adding them
 *     to the LoRA list would apply them twice,
 *   - media params record a server-side source path, which is reusable, or inline data, which is not.
 *
 * Fooocus JSON and the A1111 text block are converted on the way in, as interpretMetadata does
 * (src/wwwroot/js/genpage/helpers/metadatahelpers.js:83). Params named in the user's
 * `reuseparamexcludelist` setting are neither reset nor overwritten.
 */

import { useCallback } from 'react';
import { t } from '@/i18n';
import { useUserSetting } from '@/settings/useUserSetting';
import type { ParamSchema } from '@/api/types';
import { cleanModelName, useParamSchema, type NormalizedSchema } from './schema';
import {
    isMediaListType,
    isMediaType,
    isServerMediaPath,
    kindOfValue,
    mediaKindOf,
    type MediaMeta
} from './media';
import { useParamStore, type ParamValue } from './store';

/** Old parameter ids that were renamed, so an older image still loads onto today's form.
 *  Mirrors T2IParamTypes.ParameterRemaps (src/Text2Image/T2IParamTypes.cs:226), which the API does
 *  not expose - keep the two in sync by hand. */
const REMAPS: Record<string, string> = {
    saveintermediateimages: 'outputintermediateimages',
    textvideofps: 'videofps',
    textvideoboomerang: 'videoboomerang',
    textvideoformat: 'videoformat'
};

interface ImageParameters {
    /** The recorded parameter values, keyed by param id. */
    params: Record<string, unknown>;
    /** `sui_extra_data`, which holds media filenames and the pre-wildcard prompts. */
    extra: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A param id as the existing interface derives one from a label: lowercase letters only.
 *  Mirrors cleanParamName (params.js:1577). */
export function cleanParamName(name: string): string {
    return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** Fooocus key names for the Swarm params they correspond to (fooocusMetadataMap,
 *  metadatahelpers.js:59). The original maps `denoise` to `imageinitcreativity`, which is no param
 *  at all; the param it means is `initimagecreativity`. */
const FOOOCUS_KEYS: [string, string][] = [
    ['Prompt', 'prompt'],
    ['Negative', 'negativeprompt'],
    ['cfg', 'cfgscale'],
    ['sampler_name', 'sampler'],
    ['base_model_name', 'model'],
    ['denoise', 'initimagecreativity']
];

function fromFooocus(data: Record<string, unknown>): Record<string, unknown> {
    const params = { ...data };
    for (const [from, to] of FOOOCUS_KEYS) {
        if (from in params) {
            params[to] = params[from];
            delete params[from];
        }
    }
    // Fooocus writes nulls for what it did not use.
    for (const key of Object.keys(params)) {
        if (params[key] === null || params[key] === undefined) {
            delete params[key];
        }
    }
    return params;
}

/** Best-effort read of the A1111 text block: the prompt, an optional "Negative prompt:" line, then
 *  one line of comma-separated `Key: value` pairs. It has no formal syntax, so this follows
 *  upvertAutoWebuiMetadataToSwarm (metadatahelpers.js:3) rather than trying to be clever. */
function fromAutoWebui(text: string, schema: NormalizedSchema): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const marker = '\nNegative prompt: ';
    const at = text.indexOf(marker);
    let rest: string;
    if (at !== -1) {
        params.prompt = text.slice(0, at);
        const after = text.slice(at + marker.length);
        const lineEnd = after.indexOf('\n');
        params.negativeprompt = lineEnd === -1 ? after : after.slice(0, lineEnd);
        rest = lineEnd === -1 ? '' : after.slice(lineEnd + 1);
    }
    else {
        const lines = text.split('\n');
        params.prompt = lines.slice(0, -1).join('\n');
        rest = lines[lines.length - 1];
    }
    const lines = rest.split('\n');
    for (const part of lines[lines.length - 1].split(',')) {
        const pair = part.split(':').map(entry => entry.trim());
        if (pair.length !== 2) {
            continue;
        }
        const id = cleanParamName(pair[0]);
        if (schema.byId.has(id)) {
            params[id] = pair[1];
        }
        else if (id === 'size') {
            const size = pair[1].split('x').map(entry => parseInt(entry));
            if (size.length === 2) {
                params.width = size[0];
                params.height = size[1];
            }
        }
        else if (id === 'scheduletype') {
            params.scheduler = pair[1].toLowerCase();
        }
        else {
            params[pair[0]] = pair[1];
        }
    }
    return params;
}

/** Reads the metadata blob into params + extra, or throws with a reason it can't be reused.
 *  Takes Swarm's own JSON, Fooocus JSON, or an A1111 text block. */
function readMetadata(raw: string | null | undefined, schema: NormalizedSchema): ImageParameters {
    const text = raw?.trim();
    if (!text) {
        throw new Error(t('reuse.noParameters'));
    }
    let params: Record<string, unknown>;
    let extra: Record<string, unknown>;
    if (text.startsWith('{')) {
        let data: unknown;
        try {
            data = JSON.parse(text);
        }
        catch {
            throw new Error(t('reuse.unreadableMetadata'));
        }
        if (!isRecord(data)) {
            throw new Error(t('reuse.unreadableMetadata'));
        }
        // Swarm images nest their params; images from other tools tend to be one flat object.
        if (isRecord(data.sui_image_params)) {
            params = { ...(data.sui_image_params as Record<string, unknown>) };
        }
        else if ('Prompt' in data) {
            params = fromFooocus(data);
        }
        else {
            params = { ...data };
        }
        extra = isRecord(data.sui_extra_data) ? { ...(data.sui_extra_data as Record<string, unknown>) } : params;
    }
    else if (text.includes('\n')) {
        params = fromAutoWebui(text, schema);
        extra = params;
    }
    else {
        throw new Error(t('reuse.unreadableMetadata'));
    }
    for (const [oldId, newId] of Object.entries(REMAPS)) {
        if (oldId in params) {
            params[newId] = params[oldId];
            delete params[oldId];
        }
    }
    if (typeof extra.original_prompt === 'string') {
        params.prompt = extra.original_prompt;
    }
    if (typeof extra.original_negativeprompt === 'string') {
        params.negativeprompt = extra.original_negativeprompt;
    }
    // A recorded width/height with no aspect ratio came from the custom setting, not from a preset.
    if ('width' in params && 'height' in params && !('aspectratio' in params)) {
        params.aspectratio = 'Custom';
    }
    dropPromptedLoras(params, extra);
    return { params, extra };
}

/** Removes LoRAs the prompt itself pulled in, which the generation would otherwise apply twice.
 *  Older images (pre-0.9.7) have no `prompted_loras`; there, confinement -1 marks them. */
function dropPromptedLoras(params: Record<string, unknown>, extra: Record<string, unknown>): void {
    const loras = params.loras;
    const weights = params.loraweights;
    const confinements = params.lorasectionconfinement;
    if (!Array.isArray(loras) || !Array.isArray(weights) || !Array.isArray(confinements)) {
        return;
    }
    if (loras.length !== weights.length || loras.length !== confinements.length) {
        return;
    }
    const prompted = Array.isArray(extra.prompted_loras) ? extra.prompted_loras : [];
    const version = typeof params.swarm_version === 'string' ? params.swarm_version : '';
    const old = !version || /^0\.9\.[0-6]\./.test(version);
    const keep = loras.map((lora, index) => (old ? Number(confinements[index]) === -1 : !prompted.includes(lora)));
    params.loras = loras.filter((_, index) => keep[index]);
    params.loraweights = weights.filter((_, index) => keep[index]);
    if (old) {
        delete params.lorasectionconfinement;
    }
    else {
        params.lorasectionconfinement = confinements.filter((_, index) => keep[index]);
    }
}

function asList(value: unknown): unknown[] {
    if (value === null || value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

/** The media paths for a param: its own recorded value, or failing that the `<id>_filename` extra
 *  data. Anything that isn't a server-side path is dropped - inline data and bare original file
 *  names are not something the server can resolve back into an input. */
function mediaPaths(param: ParamSchema, source: ImageParameters): string[] {
    const serverPaths = (values: unknown[]) =>
        values.filter((value): value is string => typeof value === 'string' && isServerMediaPath(value));
    const recorded = serverPaths(asList(source.params[param.id]));
    const paths = recorded.length > 0 ? recorded : serverPaths(asList(source.extra[`${param.id}_filename`]));
    return isMediaListType(param.type) ? paths : paths.slice(0, 1);
}

/** Whether a list param holds model names (`loras`), rather than plain strings (`loraweights`). */
function isModelList(param: ParamSchema, schema: NormalizedSchema): boolean {
    return param.type === 'list' && param.subtype !== null && param.subtype in schema.models;
}

/** The recorded value in the shape the param's control expects, or undefined for nothing usable.
 *
 * Model names go through cleanModelName so they match an entry in the dropdown: metadata already
 * records the cleaned form, but an image written by an older Swarm may still carry the file name. */
function coerce(param: ParamSchema, raw: unknown, schema: NormalizedSchema): ParamValue | undefined {
    if (raw === null || raw === undefined || raw === '') {
        return undefined;
    }
    switch (param.type) {
        case 'boolean':
            return String(raw) === 'true' || raw === true;
        case 'integer':
        case 'decimal': {
            const number = Number(raw);
            return Number.isFinite(number) ? number : undefined;
        }
        case 'list': {
            const entries = Array.isArray(raw)
                ? raw.map(String)
                : String(raw)
                      .split(',')
                      .map(entry => entry.trim())
                      .filter(Boolean);
            return isModelList(param, schema) ? entries.map(cleanModelName) : entries;
        }
        case 'model':
            return Array.isArray(raw) ? undefined : cleanModelName(String(raw));
        default:
            return Array.isArray(raw) ? undefined : String(raw);
    }
}

function metaFor(param: ParamSchema, path: string): MediaMeta {
    return {
        name: path.slice(path.lastIndexOf('/') + 1),
        kind: kindOfValue(path, mediaKindOf(param.type))
    };
}

/** Switches on every group above a param, and expands them, so the reused value is both live and
 *  visible. A value inside a switched-off group is silently dropped at generation time. */
function revealGroups(param: ParamSchema, schema: NormalizedSchema): void {
    const store = useParamStore.getState();
    let group = param.group ? schema.groupsById.get(param.group) : undefined;
    while (group) {
        if (group.toggles) {
            store.setGroupToggle(group.id, true);
        }
        store.setGroupOpen(group.id, true);
        group = group.parent ? schema.groupsById.get(group.parent) : undefined;
    }
}

/** The `reuseparamexcludelist` user setting as param ids. */
export function parseExcludeList(setting: string | null | undefined): string[] {
    return (setting ?? '').split(',').map(cleanParamName).filter(Boolean);
}

/** Loads an image's recorded parameters into the form, replacing what is there. Params in
 *  `exclude` keep their current value. Throws when the metadata can't be read, or holds nothing
 *  this form has a param for - before anything is reset, so a failed reuse changes nothing. */
export function applyImageParameters(
    schema: NormalizedSchema,
    raw: string | null | undefined,
    exclude: string[] = []
): void {
    const source = readMetadata(raw, schema);
    const excluded = new Set(exclude);

    const updates: { param: ParamSchema; value: ParamValue; media?: MediaMeta[] }[] = [];
    for (const param of schema.params) {
        if (param.nonreusable || excluded.has(param.id)) {
            continue;
        }
        if (isMediaType(param.type)) {
            const paths = mediaPaths(param, source);
            if (paths.length === 0) {
                continue;
            }
            updates.push({
                param,
                value: isMediaListType(param.type) ? paths : paths[0],
                media: paths.map(path => metaFor(param, path))
            });
        }
        else {
            const value = coerce(param, source.params[param.id], schema);
            if (value !== undefined) {
                updates.push({ param, value });
            }
        }
    }
    if (updates.length === 0) {
        throw new Error(t('reuse.nothingReusable'));
    }

    const store = useParamStore.getState();
    // Reuse means "generate this image again", so anything the image did not record goes back to
    // default rather than lingering from whatever was last set up.
    store.resetAll([...excluded]);
    for (const update of updates) {
        store.setValue(update.param.id, update.value);
        if (update.media) {
            store.setMedia(update.param.id, update.media);
        }
        if (update.param.toggleable) {
            store.setToggle(update.param.id, true);
        }
        revealGroups(update.param, schema);
    }
}

/** Applies an image's parameters to the generation form. Throws with a readable message when the
 *  image carries nothing reusable, or when the param schema hasn't loaded yet. */
export function useReuseParameters(): (metadata: string | null | undefined) => void {
    const schema = useParamSchema();
    const excludeSetting = useUserSetting<string>('reuseparamexcludelist', 'wildcardseed');
    return useCallback(
        (metadata: string | null | undefined) => {
            if (!schema) {
                throw new Error(t('reuse.schemaLoading'));
            }
            applyImageParameters(schema, metadata, parseExcludeList(excludeSetting));
        },
        [schema, excludeSetting]
    );
}

/** Loads parameters from raw image metadata - the text of a PNG `parameters` chunk or an EXIF
 *  UserComment, as a dropped file carries it - into the form. Accepts Swarm, Fooocus and A1111
 *  formats. The returned function throws an Error with a readable message on failure, leaving the
 *  form untouched. */
export const useApplyRawImageMetadata = useReuseParameters;
