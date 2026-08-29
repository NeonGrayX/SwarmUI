/** Workspace pane sizing and the named layout presets: a few deliberate arrangements, plus free
 *  resizing of each pane.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayoutPreset = 'default' | 'wide-canvas' | 'params-focus';

export interface PaneSizes {
    /** Parameter panel width in px. */
    params: number;
    /** Batch rail width in px. */
    batch: number;
}

export const PRESETS: Record<LayoutPreset, { labelKey: string; sizes: PaneSizes }> = {
    default: { labelKey: 'layout.preset.default', sizes: { params: 352, batch: 200 } },
    'wide-canvas': { labelKey: 'layout.preset.wideCanvas', sizes: { params: 264, batch: 132 } },
    'params-focus': { labelKey: 'layout.preset.paramsFocus', sizes: { params: 520, batch: 160 } }
};

const MIN = { params: 220, batch: 108 };
const MAX = { params: 720, batch: 420 };

interface LayoutStore extends PaneSizes {
    preset: LayoutPreset;
    resize: (pane: keyof PaneSizes, deltaPx: number) => void;
    applyPreset: (preset: LayoutPreset) => void;
}

export const useLayoutStore = create<LayoutStore>()(
    persist(
        set => ({
            ...PRESETS.default.sizes,
            preset: 'default',
            resize: (pane, deltaPx) =>
                set(state => ({
                    [pane]: Math.min(MAX[pane], Math.max(MIN[pane], state[pane] + deltaPx)),
                    // Any manual resize means the layout no longer matches a named preset.
                    preset: state.preset
                })),
            applyPreset: preset => set({ ...PRESETS[preset].sizes, preset })
        }),
        { name: 'swarm-ui-layout' }
    )
);
