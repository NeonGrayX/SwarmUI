/** Client state for the image editor: whether it is open, and the engine it is open on.
 *
 * The engine is a long-lived imperative object rather than store state, because its contents are
 * canvases: putting them behind an immutable-update store would mean copying megabytes per stroke.
 * The store holds the one genuinely reactive fact - open or closed - plus the handle to the engine.
 *
 * While the editor is open, generation reads its image and mask instead of the `initimage` and
 * `maskimage` params; see `useGenInput` (src/generate/input.ts) and `editorOverrides` below.
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { ImageEditorEngine } from './engine';
import type { EditorExport } from './types';

/** Params the editor supplies at generation time, and which the parameter panel therefore hides
 *  while it is open. The legacy UI hides the same two (doParamHides, image_editor.js:1010). */
export const EDITOR_OWNED_PARAMS: ReadonlySet<string> = new Set(['initimage', 'maskimage']);

/** One engine for the session. Reopening the editor on another image resets its document rather
 *  than building a new engine, so tool settings (brush size, colour) survive. */
const engine = new ImageEditorEngine();

interface EditorStore {
    engine: ImageEditorEngine;
    open: boolean;
    /** Set when the editor was opened on a specific image, for the window title. */
    sourceName: string | null;
    openWithImage: (src: string, name?: string) => Promise<void>;
    openBlank: (width: number, height: number) => void;
    close: () => void;
}

export const useEditorStore = create<EditorStore>(set => ({
    engine,
    open: false,
    sourceName: null,

    openWithImage: (src, name) =>
        new Promise<void>((resolve, reject) => {
            const img = new Image();
            // Generated images are served from the same origin, but a data URL or a future remote
            // path would taint the canvas and break every export without this.
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                engine.setBaseImage(img);
                set({ open: true, sourceName: name ?? null });
                resolve();
            };
            img.onerror = () => reject(new Error('Failed to load the image for editing.'));
            img.src = src;
        }),

    openBlank: (width, height) => {
        engine.setBlankImage(width, height);
        set({ open: true, sourceName: null });
    },

    close: () => set({ open: false })
}));

/** Re-renders on structural changes to the engine - a layer, a tool, a tool option, the selection
 *  appearing or vanishing. Pointer motion and repaints deliberately do not fire this. */
export function useEditorVersion(): number {
    return useSyncExternalStore(engine.subscribe, engine.getVersion);
}

/** The image and mask a generation should use, or null when the editor is closed.
 *
 * Read imperatively at send time rather than subscribed to, because exporting rasterizes every
 * layer twice and there is no reason to pay that on each keystroke. */
export function editorOverrides(): EditorExport | null {
    return useEditorStore.getState().open ? engine.exportForGeneration() : null;
}
