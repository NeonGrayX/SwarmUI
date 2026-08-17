/** Client state for generation parameters: values, per-param toggles, group open/toggle state.
 *
 * Kept separate from the schema (which is server state owned by TanStack Query) so that a schema
 * refetch never clobbers what the user has typed.
 */

import { create } from 'zustand';
import type { ParamSchema } from '@/api/types';
import type { MediaMeta } from './media';

export type ParamValue = string | number | boolean | string[] | null;

interface ParamStore {
    values: Record<string, ParamValue>;
    /** Explicit on/off for `toggleable` params. Absent means off. */
    toggles: Record<string, boolean>;
    /** Explicit on/off for groups with `toggles`. Absent means off. */
    groupToggles: Record<string, boolean>;
    /** Expanded state per group. Absent means "use the group's `open` default". */
    openGroups: Record<string, boolean>;
    /** Per media param, one entry per value entry: file name, resolution, duration.
     *  Display only - and the source of the `_filename`/`_resolution` generation metadata. */
    media: Record<string, MediaMeta[]>;

    setValue: (id: string, value: ParamValue) => void;
    setMedia: (id: string, metas: MediaMeta[]) => void;
    setToggle: (id: string, on: boolean) => void;
    setGroupToggle: (id: string, on: boolean) => void;
    setGroupOpen: (id: string, open: boolean) => void;
    /** Clears a param back to schema default and switches its toggle off. */
    reset: (id: string) => void;
    /** Clears everything. */
    resetAll: () => void;
}

export const useParamStore = create<ParamStore>(set => ({
    values: {},
    toggles: {},
    groupToggles: {},
    openGroups: {},
    media: {},

    setValue: (id, value) => set(s => ({ values: { ...s.values, [id]: value } })),
    setMedia: (id, metas) => set(s => ({ media: { ...s.media, [id]: metas } })),
    setToggle: (id, on) => set(s => ({ toggles: { ...s.toggles, [id]: on } })),
    setGroupToggle: (id, on) => set(s => ({ groupToggles: { ...s.groupToggles, [id]: on } })),
    setGroupOpen: (id, open) => set(s => ({ openGroups: { ...s.openGroups, [id]: open } })),

    reset: id =>
        set(s => {
            const values = { ...s.values };
            const toggles = { ...s.toggles };
            const media = { ...s.media };
            delete values[id];
            delete toggles[id];
            delete media[id];
            return { values, toggles, media };
        }),

    resetAll: () => set({ values: {}, toggles: {}, groupToggles: {}, media: {} })
}));

/** The schema default coerced to the shape the control expects. */
export function defaultValue(param: ParamSchema): ParamValue {
    const raw = param.default;
    switch (param.type) {
        case 'boolean':
            return raw === 'true' || raw === 'True';
        case 'integer':
        case 'decimal':
            return raw === null || raw === '' ? param.min : Number(raw);
        case 'list':
        case 'image_list':
        case 'audio_list':
        case 'video_list':
            return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
        default:
            return raw ?? '';
    }
}

/** Current value for a param, falling back to its schema default. */
export function valueOf(
    param: ParamSchema,
    values: Record<string, ParamValue>
): ParamValue {
    return param.id in values ? values[param.id] : defaultValue(param);
}

/** Whether the user has moved a param away from its default, or switched its toggle on.
 *  Mirrors the `isAltered` computation in hideUnsupportableParams
 *  (src/wwwroot/js/genpage/gentab/params.js:1409). */
export function isAltered(
    param: ParamSchema,
    values: Record<string, ParamValue>,
    toggles: Record<string, boolean>
): boolean {
    if (param.toggleable) {
        return toggles[param.id] === true;
    }
    if (!(param.id in values)) {
        return false;
    }
    return String(values[param.id]) !== String(defaultValue(param));
}
