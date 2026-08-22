/** Opening the image editor from elsewhere in the UI.
 *
 * Opening on an image also sets the output resolution to that image's, and the aspect ratio to
 * Custom - otherwise the first generation would silently resize the canvas the user just set up.
 * The legacy UI does the same from its Edit Image button (currentimagehandler.js:1197).
 */

import { useCallback } from 'react';
import { useParamSchema } from '@/params/schema';
import { defaultValue, useParamStore } from '@/params/store';
import { useEditorStore } from './store';

export interface OpenEditor {
    /** False when this server's parameter set has no init image, so an edit could not be used. */
    available: boolean;
    editImage: (src: string, name?: string) => Promise<void>;
    /** Opens a blank white canvas at the current width/height. */
    newCanvas: () => void;
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
            await openWithImage(src, name);
            const engine = useEditorStore.getState().engine;
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
        openBlank(sizeOf('width', 1024), sizeOf('height', 1024));
    }, [openBlank, sizeOf]);

    return { available: Boolean(schema?.byId.get('initimage')), editImage, newCanvas };
}
