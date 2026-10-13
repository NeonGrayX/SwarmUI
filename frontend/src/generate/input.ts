/** Builds the request body for a generation from the param store.
 *
 * Two rules the server expects:
 *   - a param whose own toggle, or any containing group's toggle, is off is not sent at all
 *   - media params contribute `<id>_filename` / `<id>_resolution` / `<id>_duration` to
 *     `extra_metadata`, so the saved image records what was fed into it
 *
 * Only what the user actually set, or switched on, is sent, and the server supplies the rest -
 * which is why a default redefined in Parameter Configuration has to be sent explicitly.
 */

import { useCallback } from 'react';
import type { ParamSchema } from '@/api/types';
import { useSupportedFeatures } from '@/params/features';
import { useParamSchema } from '@/params/schema';
import type { NormalizedSchema } from '@/params/schema';
import { isMediaListType, isMediaType, mediaValues, type MediaMeta } from '@/params/media';
import { defaultValue, useParamStore, type ParamValue } from '@/params/store';
import { useParamMemory } from '@/params/useParamMemory';
import { isSupported } from '@/params/visibility';

export interface GenInputState {
    values: Record<string, ParamValue>;
    toggles: Record<string, boolean>;
    groupToggles: Record<string, boolean>;
    media: Record<string, MediaMeta[]>;
}

/** Whether a param and every group above it is switched on. */
function isEnabled(param: ParamSchema, schema: NormalizedSchema, state: GenInputState): boolean {
    if (param.toggleable && state.toggles[param.id] !== true) {
        return false;
    }
    let group = param.group ? schema.groupsById.get(param.group) : undefined;
    while (group) {
        if (group.toggles && state.groupToggles[group.id] !== true) {
            return false;
        }
        group = group.parent ? schema.groupsById.get(group.parent) : undefined;
    }
    return true;
}

/** Whether a param is switched on by something - its own toggle, or a group toggle above it. A
 *  switch the user turned on is a request for the value it shows, even one never edited. */
function isSwitchedOn(param: ParamSchema, schema: NormalizedSchema): boolean {
    if (param.toggleable) {
        return true;
    }
    let group = param.group ? schema.groupsById.get(param.group) : undefined;
    while (group) {
        if (group.toggles) {
            return true;
        }
        group = group.parent ? schema.groupsById.get(group.parent) : undefined;
    }
    return false;
}

function isEmpty(value: ParamValue): boolean {
    return value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Adds the media facts for one param. Single params get plain strings; list params get arrays
 *  aligned with the values (with nulls for entries we know nothing about), which the server keeps
 *  as arrays (RequestToParams, src/WebAPI/T2IAPI.cs:196). */
function addMediaMetadata(
    extra: Record<string, unknown>,
    param: ParamSchema,
    value: ParamValue,
    metas: MediaMeta[]
): void {
    const entries = mediaValues(value).map((_, index) => metas[index]);
    if (entries.length === 0) {
        return;
    }
    const names = entries.map(meta => meta?.name ?? null);
    const resolutions = entries.map(meta => (meta?.width && meta?.height ? `${meta.width}x${meta.height}` : null));
    const durations = entries.map(meta => (meta?.duration ? String(meta.duration) : null));
    const list = isMediaListType(param.type);
    const put = (suffix: string, parts: (string | null)[]) => {
        if (!parts.some(Boolean)) {
            return;
        }
        extra[`${param.id}_${suffix}`] = list ? parts : parts[0];
    };
    put('filename', names);
    put('resolution', resolutions);
    put('duration', durations);
}

/** The full request body, minus `images` and `session_id` which the socket call adds. */
export function buildGenInput(
    schema: NormalizedSchema | null,
    state: GenInputState,
    supportedFeatures: string[] = []
): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};

    for (const [id, value] of Object.entries(state.values)) {
        const param = schema?.byId.get(id);
        if (isEmpty(value)) {
            continue;
        }
        // A backend that lacks a param's feature cannot take it, however it got set - isParamEnabled
        // (params.js:1027) skips those the same way.
        if (param && schema && (!isEnabled(param, schema, state) || !isSupported(param, supportedFeatures))) {
            continue;
        }
        input[id] = value;
        if (param && isMediaType(param.type)) {
            addMediaMetadata(extra, param, value, state.media[id] ?? []);
        }
    }

    // A param the user never touched contributes nothing above, so the server would fall back to
    // its own default. Two cases have to be sent explicitly anyway: a default the user redefined in
    // Parameter Configuration, so the panel and the generation agree on what "default" means; and
    // a param switched on by its toggle or its group's, which the existing interface sends at
    // whatever the control shows - switching on a group is often the whole request.
    for (const param of schema?.params ?? []) {
        if (param.id in state.values || !schema) {
            continue;
        }
        const value = defaultValue(param);
        if (isEmpty(value) || !isEnabled(param, schema, state) || !isSupported(param, supportedFeatures)) {
            continue;
        }
        const original = schema.originals.get(param.id);
        const redefined = original !== undefined && String(value) !== String(defaultValue(original));
        if (!redefined && !isSwitchedOn(param, schema)) {
            continue;
        }
        input[param.id] = value;
    }

    // A param that only means anything beside another one's non-default value goes when that one
    // is at its default (getGenInput, params.js:1082).
    for (const param of schema?.params ?? []) {
        if (!param.depend_non_default || !(param.id in input)) {
            continue;
        }
        const other = schema?.byId.get(param.depend_non_default);
        if (!other) {
            continue;
        }
        if (!(other.id in input) || String(input[other.id]) === String(defaultValue(other))) {
            delete input[param.id];
        }
    }

    // The same post-processing getGenInput does (params.js:1092): side length is meaningless at a
    // custom aspect ratio, and no VAE - or 'Automatic' - asks the server to pick the model's own.
    if (input.aspectratio === 'Custom') {
        delete input.sidelength;
    }
    if (!input.vae || input.vae === 'Automatic') {
        input.automaticvae = true;
        delete input.vae;
    }

    if (Object.keys(extra).length > 0) {
        input.extra_metadata = extra;
    }
    return input;
}

/** Snapshots the param store into a request body on demand. Reading the store at call time rather
 *  than subscribing keeps the Generate button from re-rendering on every keystroke. */
export function useGenInput(): () => Record<string, unknown> {
    // Whatever generates has to see remembered values checked against the schema, whether or not
    // the panel has been mounted yet.
    useParamMemory();
    const schema = useParamSchema();
    const features = useSupportedFeatures();
    return useCallback(
        () => buildGenInput(schema, useParamStore.getState(), features),
        [schema, features]
    );
}
