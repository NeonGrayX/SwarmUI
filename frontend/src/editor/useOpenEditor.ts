/** Opening the image editor from elsewhere in the UI.
 *
 * Opening on an image also sets the output resolution to that image's, and the aspect ratio to
 * Custom - otherwise the first generation would silently resize the canvas just set up.
 */

import { useCallback } from 'react';
import { useParamSchema } from '@/params/schema';
import { defaultValue, useParamStore } from '@/params/store';
import { useEditorStore } from './store';

/** The editor's chrome, fetched alongside the engine rather than after it: `ImageEditor` is
 *  lazy at its mount point in the workspace, and both chunks are wanted at the same moment. */
function preloadEditorUI(): void {
    void import('@/components/editor/ImageEditor');
}

export interface OpenEditor {
    /** False when this server's parameter set has no init image, so an edit could not be used. */
    available: boolean;
    editImage: (src: string, name?: string) => Promise<void>;
    /** Opens a blank white canvas at the current width/height. Async because the editor's engine
     *  is fetched on first use; both openers resolve once it is on screen. */
    newCanvas: () => Promise<void>;
}

export function useOpenEditor(): OpenEditor {
    const schema = useParamSchema();
    const openWithImage = useEditorStore(s => s.openWithImage);
    const openBlank = useEditorStore(s => s.openBlank);

    /** The current value of a numeric param, falling back to its schema default. */
    const sizeOf = useCallback(
        (id: string, fallback: number): number => {
            const store = useParamStore.getState();
            const raw = store.values[id];
            if (raw !== undefined && raw !== null && raw !== '') {
                return Number(raw);
            }
            const param = schema?.byId.get(id);
            return param ? Number(defaultValue(param)) || fallback : fallback;
        },
        [schema]
    );

    const editImage = useCallback(
        async (src: string, name?: string) => {
            preloadEditorUI();
            const engine = await openWithImage(src, name);
            const store = useParamStore.getState();
            store.setValue('width', engine.realWidth);
            store.setValue('height', engine.realHeight);
            if (schema?.byId.get('aspectratio')) {
                store.setValue('aspectratio', 'Custom');
            }
        },
        [openWithImage, schema]
    );

    const newCanvas = useCallback(() => {
        preloadEditorUI();
        return openBlank(sizeOf('width', 1024), sizeOf('height', 1024));
    }, [openBlank, sizeOf]);

    return { available: Boolean(schema?.byId.get('initimage')), editImage, newCanvas };
}
