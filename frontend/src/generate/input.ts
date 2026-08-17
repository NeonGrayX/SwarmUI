/** Builds the request body for a generation from the param store.
 *
 * Replaces getGenInput (src/wwwroot/js/genpage/gentab/params.js:1016), which reads values back out
 * of the DOM. Two rules carry over from there:
 *   - a param whose own toggle, or any containing group's toggle, is off is not sent at all
 *   - media params contribute `<id>_filename` / `<id>_resolution` / `<id>_duration` to
 *     `extra_metadata`, so the saved image records what was fed into it
 */

import { useCallback } from 'react';
import type { ParamSchema } from '@/api/types';
import { useParamSchema } from '@/params/schema';
import type { NormalizedSchema } from '@/params/schema';
import { isMediaListType, isMediaType, mediaValues, type MediaMeta } from '@/params/media';
import { useParamStore, type ParamValue } from '@/params/store';

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

function isEmpty(value: ParamValue): boolean {
    return value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Adds the media facts for one param. Single params get plain strings; list params get arrays
 *  aligned with the values (with nulls for entries we know nothing about), which the server keeps
 *  as arrays (RequestToParams, src/WebAPI/T2IAPI.cs:202). */
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
    state: GenInputState
): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};

    for (const [id, value] of Object.entries(state.values)) {
        const param = schema?.byId.get(id);
        if (isEmpty(value) || (param && schema && !isEnabled(param, schema, state))) {
            continue;
        }
        input[id] = value;
        if (param && isMediaType(param.type)) {
            addMediaMetadata(extra, param, value, state.media[id] ?? []);
        }
    }

    if (Object.keys(extra).length > 0) {
        input.extra_metadata = extra;
    }
    return input;
}

/** Snapshots the param store into a request body on demand. Reading the store at call time rather
 *  than subscribing keeps the Generate button from re-rendering on every keystroke. */
export function useGenInput(): () => Record<string, unknown> {
    const schema = useParamSchema();
    return useCallback(() => buildGenInput(schema, useParamStore.getState()), [schema]);
}
