/** Helpers for media-typed parameters (image / audio / video, single or list).
 *
 * A media param's value is either an inline `data:` URL or a server-side path (`inputs/…`,
 * `raw/…`, `Starred/…`); the server accepts both and strips the data prefix itself
 * (T2IParamTypes.cs:1116). List params hold an array of those, which the API joins with its
 * `\n|||\n` splitter (RequestToParams, src/WebAPI/T2IAPI.cs:217).
 */

import { t } from '@/i18n';
import type { ParamDataType } from '@/api/types';

export type MediaKind = 'image' | 'audio' | 'video';

/** What we know about one media value, for display and for generation metadata. */
export interface MediaMeta {
    /** Original file name, or the server path the value came from. */
    name: string;
    kind: MediaKind;
    width?: number;
    height?: number;
    /** Seconds, for audio/video. */
    duration?: number;
}

const MEDIA_TYPES: ParamDataType[] = [
    'image',
    'image_list',
    'audio',
    'audio_list',
    'video',
    'video_list'
];

export function isMediaType(type: ParamDataType): boolean {
    return MEDIA_TYPES.includes(type);
}

export function isMediaListType(type: ParamDataType): boolean {
    return type.endsWith('_list') && isMediaType(type);
}

export function mediaKindOf(type: ParamDataType): MediaKind {
    const base = type.replace('_list', '');
    return base === 'audio' || base === 'video' ? base : 'image';
}

/** `accept` for the file picker. Image inputs also take video, because video models drive their
 *  init image from a clip. */
export const FILE_ACCEPT: Record<MediaKind, string> = {
    image: 'image/png, image/jpeg, image/webp, image/gif, video/mp4, video/webm, video/quicktime',
    audio: 'audio/wav, audio/wave, audio/mp3, audio/mpeg, audio/aac, audio/ogg, audio/flac',
    video: 'video/mp4, video/webm, video/quicktime'
};

/** MIME prefixes a param of this kind will take, used for drop and paste where there is no
 *  `accept` attribute to lean on. */
const ACCEPTED_PREFIXES: Record<MediaKind, string[]> = {
    image: ['image/', 'video/'],
    audio: ['audio/'],
    video: ['video/']
};

export function acceptsFile(kind: MediaKind, file: File): boolean {
    return ACCEPTED_PREFIXES[kind].some(prefix => file.type.startsWith(prefix));
}

/** The kind to actually render a value as. A video dropped on an image param previews as video. */
export function kindOfValue(value: string, fallback: MediaKind): MediaKind {
    const source = value.startsWith('data:') ? value.slice(5, value.indexOf(';')) : extensionMime(value);
    if (source.startsWith('video/')) {
        return 'video';
    }
    if (source.startsWith('audio/')) {
        return 'audio';
    }
    if (source.startsWith('image/')) {
        return 'image';
    }
    return fallback;
}

function extensionMime(path: string): string {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
        return 'video/';
    }
    if (['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a'].includes(ext)) {
        return 'audio/';
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        return 'image/';
    }
    return '';
}

/** Whether a value is a reusable server-side media path rather than inline data.
 *  Mirrors isValidMediaPath (src/wwwroot/js/site.js:1091). */
export function isServerMediaPath(value: string): boolean {
    return value.startsWith('inputs/') || value.startsWith('raw/') || value.startsWith('Starred/');
}

/** The reverse of `mediaSrc`: the output-relative path behind a view URL.
 *
 * Both view routes are stripped, since which one a URL uses depends on a server setting the path
 * itself knows nothing about - `Output/<path>`, or `View/<user id>/<path>` when the server appends
 * the user name (imageOutPrefix). Anything else is handed back unchanged, and reads as "not one of
 * ours" to `isServerMediaPath`. Mirrors getImageFullSrc
 * (src/wwwroot/js/genpage/gentab/currentimagehandler.js:924). */
export function serverMediaPath(url: string): string {
    let path = url;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        const host = path.indexOf('/', path.indexOf('//') + 2);
        // A bare origin has no path to take, and slicing at -1 would take its last character.
        path = host === -1 ? '' : path.slice(host);
    }
    path = path.replace(/^\//, '');
    if (path.startsWith('Output/')) {
        return path.slice('Output/'.length);
    }
    if (path.startsWith('View/')) {
        const rest = path.slice('View/'.length);
        const slash = rest.indexOf('/');
        return slash === -1 ? rest : rest.slice(slash + 1);
    }
    return path;
}

/** Resolves a stored value to something an <img>/<video>/<audio> can load. Server paths are
 *  relative to the user's output directory, so they need the same prefix the Library uses. */
export function mediaSrc(value: string, outPrefix: string): string {
    if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('/')) {
        return value;
    }
    if (isServerMediaPath(value)) {
        return `/${outPrefix}/${value}`;
    }
    return value;
}

export function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(t('media.readFileFailed', { name: file.name })));
        reader.readAsDataURL(file);
    });
}

/** Fetches a URL and inlines it as a data URL, so a generated output can be fed back in as an
 *  input without the server having to resolve the view path. */
export async function urlToDataUrl(url: string): Promise<string> {
    if (url.startsWith('data:')) {
        return url;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(t('media.loadImageFailed', { status: response.status }));
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(t('media.readImageDataFailed')));
        reader.readAsDataURL(blob);
    });
}

/** "16:9"-style description of a resolution. Ported from describeAspectRatio (site.js:1328). */
export function describeAspectRatio(width: number, height: number): string {
    const wh = width / height;
    const hw = height / width;
    const round = (n: number) => Math.round(n * 100) / 100;
    if (round(wh) === 1) {
        return '1:1';
    }
    if (round(wh) % 1 === 0) {
        return `${Math.round(wh)}:1`;
    }
    if (round(hw) % 1 === 0) {
        return `1:${Math.round(hw)}`;
    }
    for (let i = 2; i < 50; i++) {
        if (round(wh * i) % 1 === 0) {
            return `${Math.round(wh * i)}:${i}`;
        }
        if (round(hw * i) % 1 === 0) {
            return `${i}:${Math.round(hw * i)}`;
        }
    }
    return wh > 1 ? `${round(wh)}:1` : `1:${round(hw)}`;
}

/** One-line caption under a preview: name, then resolution/duration once the media has loaded. */
export function describeMedia(meta: MediaMeta | undefined): string {
    if (!meta) {
        return '';
    }
    const name = meta.name.length > 40 ? `${meta.name.slice(0, 37)}…` : meta.name;
    const facts: string[] = [];
    if (meta.width && meta.height) {
        facts.push(`${meta.width}×${meta.height}, ${describeAspectRatio(meta.width, meta.height)}`);
    }
    if (meta.duration) {
        facts.push(`${Math.round(meta.duration * 100) / 100}s`);
    }
    return facts.length > 0 ? `${name} (${facts.join(', ')})` : name;
}

/** The stored value of a media param as a list, whatever its arity. */
export function mediaValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(String).filter(Boolean);
    }
    return value ? [String(value)] : [];
}
