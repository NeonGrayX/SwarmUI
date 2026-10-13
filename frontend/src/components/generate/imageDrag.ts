/** Dragging generated images around the page - from the canvas or a batch tile onto a media param,
 *  the prompt box, or out of the browser altogether.
 *
 * A dragged `<img>` only carries its URL, which a file drop zone cannot use. So the drag also
 * carries a Swarm-specific type naming the image and its metadata, and `droppedFiles` turns either
 * that or real files into `File`s, giving a drop zone one thing to handle whichever it was. */

import type { DragEvent } from 'react';
import { imageFileName } from './imageActions';

/** Custom drag type: JSON `{ url, metadata }`. */
export const SWARM_IMAGE_TYPE = 'application/x-swarm-image';

export interface DraggedImage {
    /** Same-origin URL or data: URL. */
    url: string;
    metadata?: string | null;
}

/** Fills a drag that starts on a generated image. `url` must already be resolved (imageUrl). */
export function startImageDrag(event: DragEvent, image: DraggedImage): void {
    const transfer = event.dataTransfer;
    const absolute = new URL(image.url, window.location.href).href;
    transfer.effectAllowed = 'copy';
    transfer.setData(SWARM_IMAGE_TYPE, JSON.stringify({ url: image.url, metadata: image.metadata ?? null }));
    transfer.setData('text/uri-list', absolute);
    transfer.setData('text/plain', absolute);
    // Chrome only: lets the image be dropped onto the desktop or a file manager as a file.
    if (!image.url.startsWith('data:')) {
        const mime = mimeFromName(imageFileName(image.url));
        transfer.setData('DownloadURL', `${mime}:${imageFileName(image.url)}:${absolute}`);
    }
}

/** The Swarm image a drag carries, or null for anything else. Only readable during `drop`. */
export function draggedImage(transfer: DataTransfer | null | undefined): DraggedImage | null {
    const raw = transfer?.getData(SWARM_IMAGE_TYPE);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as DraggedImage;
        return typeof parsed.url === 'string' ? parsed : null;
    }
    catch {
        return null;
    }
}

/** Whether a drag in progress is one a file drop zone can accept - real files or a Swarm image.
 *  Usable during `dragover`, when only the types are visible. */
export function isImageOrFileDrag(transfer: DataTransfer | null | undefined): boolean {
    const types = transfer?.types ?? [];
    return types.includes('Files') || types.includes(SWARM_IMAGE_TYPE);
}

function mimeFromName(name: string): string {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    switch (ext) {
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        case 'mp4':
            return 'video/mp4';
        case 'webm':
            return 'video/webm';
        default:
            return 'image/png';
    }
}

/** Fetches a URL as a File named after it. */
export async function urlToFile(url: string): Promise<File> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const name = imageFileName(url, blob.type);
    return new File([blob], name, { type: blob.type || mimeFromName(name) });
}

/** The files a drop delivers: real files when there are any, otherwise the dragged Swarm image
 *  fetched into one. Reads the transfer synchronously - its data is gone once the drop handler
 *  returns - so call it directly inside `onDrop`, eg
 *  `void droppedFiles(event.dataTransfer).then(addFiles)`. */
export function droppedFiles(transfer: DataTransfer | null | undefined): Promise<File[]> {
    const files = transfer?.files ? [...transfer.files] : [];
    if (files.length > 0) {
        return Promise.resolve(files);
    }
    const image = draggedImage(transfer);
    if (!image) {
        return Promise.resolve([]);
    }
    return urlToFile(image.url).then(file => [file]);
}
