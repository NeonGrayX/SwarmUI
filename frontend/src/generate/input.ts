/** Builds the request body for a generation from the param store.
 *
 * Two rules the server expects:
 *   - a param whose own toggle, or any containing group's toggle, is off is not sent at all
 *   - media params contribute `<id>_filename` / `<id>_resolution` / `<id>_duration` to
 *     `extra_metadata`, so the saved image records what was fed into it
 *
 * Only what the user actually set is sent, and the server supplies the rest - which is why a
 * default redefined in Parameter Configuration has to be sent explicitly.
 */

import { useCallback } from 'react';
import type { ParamSchema } from '@/api/types';
import { useCurrentStatus, useSession } from '@/api/hooks';
import { useParamSchema } from '@/params/schema';
import type { NormalizedSchema } from '@/params/schema';
import { isMediaListType, isMediaType, mediaValues, type MediaMeta } from '@/params/media';
import { defaultValue, useParamStore, type ParamValue } from '@/params/store';
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
    state: GenInputState,
    supportedFeatures: string[] = []
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

    // A param the user never touched contributes nothing above, so the server would fall back to
    // the default it shipped with - not the one the user redefined in Parameter Configuration.
    // Send those explicitly, so the panel and the generation agree on what "default" means.
    for (const param of schema?.params ?? []) {
        if (param.id in state.values || !schema) {
            continue;
        }
        const original = schema.originals.get(param.id);
        const value = defaultValue(param);
        if (!original || String(value) === String(defaultValue(original))) {
            continue;
        }
        // Feature support gates this path but not the loop above, on purpose: a value the user
        // typed is theirs to send, while one injected on their behalf has no business reaching a
        // backend that cannot take it. isParamEnabled (params.js:997) skips both.
        if (isEmpty(value) || !isEnabled(param, schema, state) || !isSupported(param, supportedFeatures)) {
            continue;
        }
        input[param.id] = value;
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
    const session = useSession();
    const status = useCurrentStatus(session.isSuccess);
    const features = status.data?.supported_features;
    return useCallback(
        () => buildGenInput(schema, useParamStore.getState(), features ?? []),
        [schema, features]
    );
}
