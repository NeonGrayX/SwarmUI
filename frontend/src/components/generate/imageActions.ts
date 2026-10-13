/** What can be done with one output image, wherever it is shown - the generate canvas, a batch
 *  tile, the history browser.
 *
 * Mirrors the legacy current-image buttons (currentimagehandler.js setCurrentImage) and the shared
 * per-image buttons (outputhistory.js buttonsForImage). Images are identified by the URL they are
 * shown from: a `/View/...` or `/Output/...` path for a saved output, or a data: URL for one that
 * was never saved - which has no path on the server, so starring, deleting and the folder actions
 * do not apply to it. */

import { useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { useSupportedFeatures } from '@/params/features';
import { serverMediaPath, urlToDataUrl } from '@/params/media';
import { useReuseParameters } from '@/params/reuse';
import { useParamSchema } from '@/params/schema';
import { useParamStore } from '@/params/store';
import { buildGenInput } from '@/generate/input';
import { useGenerateStore } from '@/generate/store';
import { validateGenInput } from '@/generate/validate';
import { useDeleteImage, useToggleImageStar } from '@/library/hooks';
import { isImageStarred } from '@/library/types';

/** An output image as the actions see it. */
export interface ActionImage {
    /** Resolved URL: a same-origin view path, or a data: URL. */
    url: string;
    metadata?: string | null;
}

const MIME_EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav'
};

/** A file name for an output URL. A data: URL has none of its own, so one is made up from its
 *  MIME type; anything else is the last path segment, without any query string. */
export function imageFileName(url: string, mime?: string): string {
    if (url.startsWith('data:')) {
        const type = mime || url.slice(5, url.search(/[;,]/));
        return `image.${MIME_EXTENSIONS[type] ?? 'png'}`;
    }
    const path = url.split(/[?#]/)[0];
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    if (name) {
        return name;
    }
    return mime ? `image.${MIME_EXTENSIONS[mime] ?? 'png'}` : 'image.png';
}

/** The output-relative path the image APIs take (`raw/2024-01-01/x.png`), or null for an image
 *  with no path on the server. Mirrors getImageFullSrc (currentimagehandler.js:940). */
export function outputPathOf(url: string): string | null {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
        return null;
    }
    return decodeURIComponent(serverMediaPath(url.split(/[?#]/)[0]));
}

/** Saves an output to disk. The view route is same-origin, so `download` is honored and the tab
 *  stays where it is. */
export function downloadOutput(url: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = imageFileName(url);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/** The same metadata with its star flag set, or null when it cannot be parsed to hold one. */
export function withStarFlag(metadata: string | null | undefined, starred: boolean): string | null {
    try {
        const parsed = JSON.parse(metadata || '{}') as Record<string, unknown>;
        return JSON.stringify({ ...parsed, is_starred: starred });
    }
    catch {
        return null;
    }
}

/** The recorded generation params, or an empty object. */
function recordedParams(metadata: string | null | undefined): Record<string, unknown> {
    try {
        const parsed = JSON.parse(metadata || '{}') as { sui_image_params?: Record<string, unknown> };
        return parsed.sui_image_params ?? {};
    }
    catch {
        return {};
    }
}

/** An image's pixel size, from the image itself rather than its metadata, which may be stale for
 *  an image that was edited after generating. */
function naturalSize(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error(`Could not load ${imageFileName(url)}.`));
        img.src = url;
    });
}

export interface ImageActions {
    /** The server lets this user star images, and this image has a path to star. */
    canStar: (image: ActionImage) => boolean;
    canDelete: (image: ActionImage) => boolean;
    /** Opening the server's own file explorer: only meaningful on the server's own PC. */
    canOpenFolder: (image: ActionImage) => boolean;
    /** Whether the folder-free path actions (copy path, view in history) apply. */
    hasPath: (image: ActionImage) => boolean;
    /** Upscale 2x and Refine both run through the init image, so need that param. */
    canUpscale: boolean;
    canRefine: boolean;
    isStarred: (image: ActionImage) => boolean;
    /** Toggles the star, resolving to the image's metadata with the new flag recorded. */
    toggleStar: (image: ActionImage) => Promise<string | null>;
    /** Deletes the file on the server. */
    deleteImage: (image: ActionImage) => Promise<void>;
    /** Loads the image's parameters into the generation form. Throws with a readable reason. */
    reuseParameters: (image: ActionImage) => void;
    /** Starts a one-image run on this image at double the size (legacy "Upscale 2x"). */
    upscale: (image: ActionImage) => Promise<void>;
    /** Starts a one-image run on this image through Refine / Upscale (legacy "Refine Image"). */
    refine: (image: ActionImage) => Promise<void>;
    openFolder: (image: ActionImage) => Promise<void>;
    copyPath: (image: ActionImage) => Promise<void>;
    copyMetadata: (image: ActionImage) => Promise<void>;
    download: (image: ActionImage) => void;
    /** Opens the history browser searched to this file. */
    viewInHistory: (image: ActionImage) => void;
}

/** Every image action, bound to the current session, schema and form. */
export function useImageActions(): ImageActions {
    const schema = useParamSchema();
    const features = useSupportedFeatures();
    const navigate = useNavigate();
    const reuse = useReuseParameters();
    // `mutateAsync` keeps its identity across renders where the mutation object does not.
    const star = useToggleImageStar().mutateAsync;
    const remove = useDeleteImage().mutateAsync;
    const mayStar = usePermission('user_star_images');
    const mayDelete = usePermission('user_delete_image');
    const mayOpenFolder = usePermission('local_image_folder');
    const canUpscale = Boolean(schema?.byId.get('initimage'));
    const canRefine = canUpscale && Boolean(schema?.groupsById.get('refineupscale'));

    /** Sends a one-image run built from the form as it stands, with `overrides` on top of it and
     *  `defaults` under it, and `groups` switched as given. Mirrors legacy doGenerate's
     *  input_overrides / input_preoverrides. */
    const quickRun = useCallback(
        (overrides: Record<string, unknown>, defaults: Record<string, unknown>, groups: Record<string, boolean>) => {
            const state = useParamStore.getState();
            const built = buildGenInput(
                schema,
                { ...state, groupToggles: { ...state.groupToggles, ...groups } },
                features
            );
            const input = { ...defaults, ...built, ...overrides, images: 1 };
            const store = useGenerateStore.getState();
            const issue = validateGenInput(schema, input, 1);
            if (issue) {
                store.fail(issue);
                return;
            }
            store.start(1, input);
        },
        [schema, features]
    );

    return useMemo<ImageActions>(() => {
        const hasPath = (image: ActionImage) => outputPathOf(image.url) !== null;
        return {
            canStar: image => mayStar && hasPath(image),
            canDelete: image => mayDelete && hasPath(image),
            canOpenFolder: image => mayOpenFolder && hasPath(image),
            hasPath,
            canUpscale,
            canRefine,
            isStarred: image => isImageStarred(image.metadata),
            toggleStar: async image => {
                const path = outputPathOf(image.url);
                if (!path) {
                    return image.metadata ?? null;
                }
                const result = await star({ path });
                return withStarFlag(image.metadata, result.new_state) ?? image.metadata ?? null;
            },
            deleteImage: async image => {
                const path = outputPathOf(image.url);
                if (path) {
                    await remove({ path });
                }
            },
            reuseParameters: image => reuse(image.metadata),
            upscale: async image => {
                const [data, size] = await Promise.all([urlToDataUrl(image.url), naturalSize(image.url)]);
                quickRun(
                    {
                        initimage: data,
                        aspectratio: 'Custom',
                        width: size.width * 2,
                        height: size.height * 2
                    },
                    { initimagecreativity: 0.4 },
                    {}
                );
            },
            refine: async image => {
                const data = await urlToDataUrl(image.url);
                const overrides: Record<string, unknown> = { initimage: data, initimagecreativity: 0 };
                const recorded = recordedParams(image.metadata);
                // Refining a refined image on its own seed burns the same noise in twice.
                if ('seed' in recorded && !('refinercontrolpercentage' in recorded)) {
                    overrides.seed = recorded.seed;
                }
                quickRun(overrides, {}, { initimage: false, refineupscale: true });
            },
            openFolder: async image => {
                const path = outputPathOf(image.url);
                if (path) {
                    await api.post('OpenImageFolder', { path });
                }
            },
            copyPath: image => navigator.clipboard.writeText(outputPathOf(image.url) ?? image.url),
            copyMetadata: image => navigator.clipboard.writeText(image.metadata ?? ''),
            download: image => downloadOutput(image.url),
            viewInHistory: image => {
                void navigate({ to: '/library/history', search: { search: imageFileName(image.url) } });
            }
        };
    }, [mayStar, mayDelete, mayOpenFolder, canUpscale, canRefine, star, remove, reuse, quickRun, navigate]);
}
