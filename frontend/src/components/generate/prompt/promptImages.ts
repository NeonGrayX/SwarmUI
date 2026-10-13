/** Attaching media to the prompt (`promptimages`) from outside its own field: pasted into the prompt
 *  box, dropped anywhere on the composer, or picked from the prompt tools menu. Mirrors
 *  imagePromptAddImage and the prompt region's drop handler (src/wwwroot/js/genpage/main.js:554,
 *  :730), which take the same three routes. */

import { useCallback } from 'react';
import { acceptsFile, fileToDataUrl, isMediaListType, kindOfValue, mediaKindOf, mediaValues, urlToDataUrl, type MediaMeta } from '@/params/media';
import { useParamSchema } from '@/params/schema';
import { useParamStore } from '@/params/store';
import { t } from '@/i18n';
import { draggedImage, SWARM_IMAGE_TYPE } from '../imageDrag';

const PROMPT_IMAGES = 'promptimages';

/** File extensions a dropped URL is taken as media for, when nothing else says what it is. */
const MEDIA_URL = /\.(png|jpe?g|webp|gif|mp4|webm|mov)(\?.*)?$/i;

export interface PromptImageAttach {
    /** Whether this server has a prompt images param at all. */
    available: boolean;
    /** Attaches the usable files among `files`; returns how many were. */
    addFiles: (files: Iterable<File>) => Promise<number>;
    /** Attaches the media at a URL (a view path, or a `data:` URL). */
    addUrl: (url: string) => Promise<void>;
}

export function usePromptImageAttach(): PromptImageAttach {
    const schema = useParamSchema();
    const param = schema?.byId.get(PROMPT_IMAGES);

    const append = useCallback(
        (added: { data: string; meta: MediaMeta }[]) => {
            if (!param || added.length === 0) {
                return;
            }
            const store = useParamStore.getState();
            const existing = mediaValues(store.values[param.id]);
            const metas = store.media[param.id] ?? [];
            // Padded to the values, so the new entries' metadata lands at the new entries' indexes.
            const padded = existing.map((value, i) => metas[i] ?? { name: t('media.pastedData'), kind: kindOfValue(value, 'image') });
            if (isMediaListType(param.type)) {
                store.setValue(param.id, [...existing, ...added.map(entry => entry.data)]);
                store.setMedia(param.id, [...padded, ...added.map(entry => entry.meta)]);
            }
            else {
                const last = added[added.length - 1];
                store.setValue(param.id, last.data);
                store.setMedia(param.id, [last.meta]);
            }
        },
        [param]
    );

    const addFiles = useCallback(
        async (files: Iterable<File>) => {
            if (!param) {
                return 0;
            }
            const kind = mediaKindOf(param.type);
            const accepted = [...files].filter(file => acceptsFile(kind, file));
            const added = await Promise.all(
                accepted.map(async file => {
                    const data = await fileToDataUrl(file);
                    return { data, meta: { name: file.name, kind: kindOfValue(data, kind) } };
                })
            );
            append(added);
            return added.length;
        },
        [param, append]
    );

    const addUrl = useCallback(
        async (url: string) => {
            if (!param) {
                return;
            }
            const data = await urlToDataUrl(url);
            const name = url.startsWith('data:') ? t('media.pastedData') : decodeURIComponent(url.slice(url.lastIndexOf('/') + 1).split('?')[0]);
            append([{ data, meta: { name, kind: kindOfValue(data, mediaKindOf(param.type)) } }]);
        },
        [param, append]
    );

    return { available: Boolean(param), addFiles, addUrl };
}

/** Whether a drag may carry something the composer would attach, judged from its types alone,
 *  which is all a page may read before the drop. A `text/uri-list` only proves to be media (or not)
 *  once dropped; see `droppedMediaUrl`. */
export function dragHasMedia(dataTransfer: DataTransfer | null): boolean {
    const types = dataTransfer?.types ?? [];
    return types.includes('Files') || types.includes(SWARM_IMAGE_TYPE) || types.includes('text/uri-list');
}

/** The media URL a drop carries, if it is not a file: the gallery's own type first, then a
 *  `text/uri-list` naming a media file. Mirrors getFileList (src/wwwroot/js/genpage/helpers/
 *  ui_improvements.js:485). */
export function droppedMediaUrl(dataTransfer: DataTransfer | null): string | null {
    if (!dataTransfer) {
        return null;
    }
    const swarm = draggedImage(dataTransfer);
    if (swarm) {
        return swarm.url;
    }
    const uri = dataTransfer
        .getData('text/uri-list')
        .split('\n')
        .map(line => line.trim())
        .find(line => line && !line.startsWith('#'));
    if (uri && (uri.startsWith('data:image/') || uri.startsWith('data:video/') || MEDIA_URL.test(uri))) {
        return uri;
    }
    return null;
}
