/** "Reuse parameters" - loading the parameters recorded in an image back into the generation form.
 *
 * Ports copy_current_image_params (src/wwwroot/js/genpage/gentab/currentimagehandler.js:590), which
 * reads the metadata blob and writes it back through the DOM; here it is a plain transform onto the
 * param store. The awkward parts carry over unchanged, because they are facts about the metadata
 * format rather than about the old UI:
 *   - `original_prompt` / `original_negativeprompt` are what the user typed, so they win over the
 *     post-wildcard prompt that was actually generated with,
 *   - LoRAs injected by `<lora:...>` syntax in the prompt are already in the prompt; re-adding them
 *     to the LoRA list would apply them twice,
 *   - media params record a server-side source path, which is reusable, or inline data, which is not.
 *
 * The legacy `reuseparamexcludelist` user setting is not honored: it lives in GetUserSettings, which
 * this UI does not otherwise read.
 */

import { useCallback } from 'react';
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
 *  not expose - the legacy UI gets it inlined into the page instead (Text2Image.cshtml:42). */
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

/** Reads the metadata blob into params + extra, or throws with a reason it can't be reused. */
function readMetadata(raw: string | null | undefined): ImageParameters {
    if (!raw) {
        throw new Error('This image has no recorded parameters.');
    }
    let data: unknown;
    try {
        data = JSON.parse(raw);
    }
    catch {
        throw new Error("This image's metadata isn't in a format this UI can read.");
    }
    if (!isRecord(data)) {
        throw new Error("This image's metadata isn't in a format this UI can read.");
    }
    // Swarm images nest their params; images from other tools tend to be one flat object.
    const params = isRecord(data.sui_image_params)
        ? { ...(data.sui_image_params as Record<string, unknown>) }
        : { ...data };
    const extra = isRecord(data.sui_extra_data) ? { ...(data.sui_extra_data as Record<string, unknown>) } : params;
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
    const keep = loras.map((lora, index) => (old ? confinements[index] === -1 : !prompted.includes(lora)));
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

/** Loads an image's recorded parameters into the form, replacing what is there.
 *  Throws when the metadata can't be read; the caller reports that to the user. */
export function applyImageParameters(schema: NormalizedSchema, raw: string | null | undefined): void {
    const source = readMetadata(raw);
    const store = useParamStore.getState();
    // Reuse means "generate this image again", so anything the image did not record goes back to
    // default rather than lingering from whatever was last set up.
    store.resetAll();

    for (const param of schema.params) {
        if (param.nonreusable) {
            continue;
        }
        if (isMediaType(param.type)) {
            const paths = mediaPaths(param, source);
            if (paths.length === 0) {
                continue;
            }
            store.setValue(param.id, isMediaListType(param.type) ? paths : paths[0]);
            store.setMedia(
                param.id,
                paths.map(path => metaFor(param, path))
            );
        }
        else {
            const value = coerce(param, source.params[param.id], schema);
            if (value === undefined) {
                continue;
            }
            store.setValue(param.id, value);
        }
        if (param.toggleable) {
            store.setToggle(param.id, true);
        }
        revealGroups(param, schema);
    }
}

/** Applies an image's parameters to the generation form. Throws with a readable message when the
 *  image carries nothing reusable, or when the param schema hasn't loaded yet. */
export function useReuseParameters(): (metadata: string | null | undefined) => void {
    const schema = useParamSchema();
    return useCallback(
        (metadata: string | null | undefined) => {
            if (!schema) {
                throw new Error('Parameters are still loading, try again in a moment.');
            }
            applyImageParameters(schema, metadata);
        },
        [schema]
    );
}
