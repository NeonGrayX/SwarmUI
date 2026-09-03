/** Client state for the image editor: whether it is open, and the engine it is open on.
 *
 * The engine is a long-lived imperative object rather than store state, because its contents are
 * canvases: putting them behind an immutable-update store would mean copying megabytes per stroke.
 * The store holds the one genuinely reactive fact - open or closed - plus the handle to the engine.
 *
 * The engine and its tools are a good fraction of this application's code, and a session that
 * never opens the editor should not pay for them, so they are fetched on first open and the
 * handle is null until then. This module itself stays cheap, which matters because the screens
 * that only ask whether the editor is open (the parameter form, the canvas) import it eagerly.
 *
 * While the editor is open, generation reads its image and mask instead of the `initimage` and
 * `maskimage` params; see `useGenInput` (src/generate/input.ts) and `editorOverrides` below.
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { ImageEditorEngine } from './engine';
import type { EditorExport } from './types';

/** Params the editor supplies at generation time, and which the parameter panel therefore hides
 *  while it is open. */
export const EDITOR_OWNED_PARAMS: ReadonlySet<string> = new Set(['initimage', 'maskimage']);

/** One engine for the session. Reopening the editor on another image resets its document rather
 *  than building a new engine, so tool settings (brush size, colour) survive - hence the cached
 *  promise, which also means two quick clicks cannot build two engines. */
let loading: Promise<ImageEditorEngine> | null = null;

/** Fetches the engine chunk on the first call and builds the session's engine from it. */
function loadEngine(): Promise<ImageEditorEngine> {
    loading ??= import('./engine').then(({ ImageEditorEngine }) => {
        const engine = new ImageEditorEngine();
        useEditorStore.setState({ engine });
        return engine;
    });
    return loading;
}

interface EditorStore {
    /** Null until the editor has been opened once. */
    engine: ImageEditorEngine | null;
    open: boolean;
    /** Set when the editor was opened on a specific image, for the window title. */
    sourceName: string | null;
    openWithImage: (src: string, name?: string) => Promise<ImageEditorEngine>;
    openBlank: (width: number, height: number) => Promise<void>;
    close: () => void;
}

export const useEditorStore = create<EditorStore>(set => ({
    engine: null,
    open: false,
    sourceName: null,

    openWithImage: async (src, name) => {
        // The engine chunk and the image download are independent, so pay for them at once.
        const [ready, image] = await Promise.all([loadEngine(), loadImage(src)]);
        ready.setBaseImage(image);
        set({ open: true, sourceName: name ?? null });
        return ready;
    },

    openBlank: async (width, height) => {
        const ready = await loadEngine();
        ready.setBlankImage(width, height);
        set({ open: true, sourceName: null });
    },

    close: () => set({ open: false })
}));

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // Generated images are served from the same origin, but a data URL or a future remote
        // path would taint the canvas and break every export without this.
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load the image for editing.'));
        img.src = src;
    });
}

/** The engine, for the editor's own components - they render only while it is open, which is only
 *  ever true once the engine exists. */
export function useEditorEngine(): ImageEditorEngine {
    const loaded = useEditorStore(s => s.engine);
    if (!loaded) {
        throw new Error('The image editor rendered before its engine was loaded.');
    }
    return loaded;
}

const NO_SUBSCRIPTION = () => () => {};
const NO_VERSION = () => 0;

/** Re-renders on structural changes to the engine - a layer, a tool, a tool option, the selection
 *  appearing or vanishing. Pointer motion and repaints deliberately do not fire this. */
export function useEditorVersion(): number {
    const loaded = useEditorStore(s => s.engine);
    return useSyncExternalStore(loaded?.subscribe ?? NO_SUBSCRIPTION, loaded?.getVersion ?? NO_VERSION);
}

/** The image and mask a generation should use, or null when the editor is closed.
 *
 * Read imperatively at send time rather than subscribed to, because exporting rasterizes every
 * layer twice and there is no reason to pay that on each keystroke. */
export function editorOverrides(): EditorExport | null {
    const state = useEditorStore.getState();
    return state.open && state.engine ? state.engine.exportForGeneration() : null;
}
