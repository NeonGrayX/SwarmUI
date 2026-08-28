/** Turning a pasted link into a downloadable model.
 *
 * Ported from ModelDownloaderUtil (src/wwwroot/js/genpage/utiltab.js:174), which is the only place
 * that knows how a Civitai or HuggingFace *page* link maps to a direct download link, and how to
 * read a model's metadata off the Civitai API — proxied through `ForwardMetadataRequest`, because
 * the browser cannot reach civitai.red itself.
 *
 * This lives apart from the page because the legacy version does its work by writing results
 * straight back into DOM inputs, which is what makes it hard to follow. Here a link resolves to one
 * value describing everything the form needs to show and send.
 */

import { api } from '@/api/client';

/** Subtypes the downloader offers first, in Library order.
 *
 * These are exactly the categories the Library browses (src/pages/Library.tsx), so a model
 * downloaded under one of them always lands somewhere the user can find it again. The server
 * accepts any registered subtype, so the rest (Clip, ClipVision, whatever extensions add) stay
 * reachable — they are just listed separately, since nothing browses them. */
export const LIBRARY_SUBTYPES = ['Stable-Diffusion', 'LoRA', 'VAE', 'Embedding', 'ControlNet'];

const HF_PREFIX = 'https://huggingface.co/';
const CIVITAI_PREFIX = 'https://civitai.red/';
/** Domains that serve the same site as civitai.red. The server normalizes these too
 *  (ModelsAPI.cs:609), but the API calls made here have to be aimed at the canonical host. */
const CIVITAI_ALIASES = ['https://civitai.com/', 'https://civitai.green/'];

/** Formats the server can be asked to fetch. */
const SAFE_EXTENSIONS = ['.safetensors', '.sft', '.gguf'];
/** Formats that can execute code when loaded, so the downloader refuses them outright. */
const PICKLE_EXTENSIONS = ['.pt', '.pth', '.ckpt', '.bin'];

/** Civitai model types, mapped to Swarm subtypes. Anything unlisted leaves the picker alone. */
const CIVITAI_SUBTYPES: Record<string, string> = {
    Checkpoint: 'Stable-Diffusion',
    LORA: 'LoRA',
    LoCon: 'LoRA',
    LyCORIS: 'LoRA',
    TextualInversion: 'Embedding',
    ControlNet: 'ControlNet',
    VAE: 'VAE'
};

/** Civitai files that ride along with a model rather than being it. */
const CIVITAI_SIDE_FILES = ['Text Encoder', 'VAE'];

/** Base models whose prompting conventions Swarm keys off a usage hint. */
const HINTED_BASE_MODELS = ['Illustrious', 'Pony'];

/** Every outcome of resolving a link. Each maps to a `downloader.status.*` message. */
export type SourceStatus =
    | 'empty'
    | 'pickle'
    | 'notALink'
    | 'direct'
    | 'hfNotAFile'
    | 'hfNotSafetensors'
    | 'hfCorrected'
    | 'hfValid'
    | 'hfUnclear'
    | 'civitaiNotAModel'
    | 'civitaiNoVersion'
    | 'civitaiNoLookup'
    | 'civitaiFailed'
    | 'civitaiUnsafeFile'
    | 'civitaiLoaded';

/** One of a Civitai version's sample outputs. */
export interface Preview {
    url: string;
    kind: 'image' | 'video';
}

/** What the Civitai API knows about the model behind the link, in display form. */
export interface CivitaiInfo {
    modelId: string;
    versionId: string;
    modelName: string;
    versionName: string;
    baseModel: string;
    date: string;
    author: string;
    /** Trained words, already joined for display. */
    triggerWords: string;
    fileName: string;
    fileSizeKb: number | null;
    /** Descriptions come back as HTML; these are the text of it. */
    description: string;
    versionDescription: string;
    pageUrl: string;
    previews: Preview[];
}

/** A resolved link: what will be downloaded, from where, and under what name. */
export interface ModelSource {
    status: SourceStatus;
    /** True when the link is good enough to hand to the server. */
    ok: boolean;
    /** The link the server should fetch, which is not always the one that was pasted. */
    downloadUrl: string;
    /** 'Save as' suggestion, empty when the link carries no usable name. */
    suggestedName: string;
    /** Subtype the source says this is, or null when it does not say. */
    subtype: string | null;
    /** modelspec fields to save beside the file, or null when the source carries no metadata. */
    metadata: Record<string, string> | null;
    civitai: CivitaiInfo | null;
    /** Fills the placeholder of the status message, where it has one. */
    detail: string;
}

function source(status: SourceStatus, extra: Partial<ModelSource> = {}): ModelSource {
    return {
        status,
        ok: false,
        downloadUrl: '',
        suggestedName: '',
        subtype: null,
        metadata: null,
        civitai: null,
        detail: '',
        ...extra
    };
}

/** Splits like `String.split`, except everything past the last wanted part stays joined onto it.
 *  Ports splitWithTail (src/wwwroot/js/util.js), which the URL parsing below is written against. */
function splitWithTail(text: string, separator: string, count: number): string[] {
    const parts = text.split(separator);
    if (parts.length <= count) {
        return parts;
    }
    return [...parts.slice(0, count - 1), parts.slice(count - 1).join(separator)];
}

function withoutQuery(url: string): string {
    return url.split('?')[0].split('#')[0];
}

function hasExtension(path: string, extensions: string[]): boolean {
    const lowered = withoutQuery(path).toLowerCase();
    return extensions.some(extension => lowered.endsWith(extension));
}

function withoutExtension(path: string): string {
    return path.replace(/\.(safetensors|sft|gguf)$/i, '');
}

/** Rewrites the Civitai mirror domains onto the canonical one. */
export function normalizeCivitaiUrl(url: string): string {
    const trimmed = url.trim();
    for (const alias of CIVITAI_ALIASES) {
        if (trimmed.startsWith(alias)) {
            return CIVITAI_PREFIX + trimmed.slice(alias.length);
        }
    }
    return trimmed;
}

/** Reads `[model id, version id]` out of any Civitai link shape. Either half may be null. */
export function parseCivitaiUrl(url: string): [string | null, string | null] {
    const normalized = normalizeCivitaiUrl(url);
    // 'models', id, name + sometimes version — or 'api', 'download', 'models', version id.
    let parts = splitWithTail(normalized.slice(CIVITAI_PREFIX.length), '/', 4);
    if (parts.length === 2 && parts[0] === 'models' && parts[1].includes('?')) {
        const [id, query] = splitWithTail(parts[1], '?', 2);
        parts = ['models', id, `?${query}`];
    }
    else if (parts.length === 2 && parts[0] === 'models' && !isNaN(parseInt(parts[1]))) {
        parts = ['models', parts[1], ''];
    }
    if (parts.length < 3) {
        return [null, null];
    }
    if (parts[0] === 'models') {
        const version = splitWithTail(parts[2], '?modelVersionId=', 2);
        return [parts[1], version.length === 2 ? version[1].split('&')[0] : null];
    }
    const isDownload = parts[0] === 'api' && parts[1] === 'download' && parts[2] === 'models';
    const isVersion = parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'model-versions';
    if ((isDownload || isVersion) && parts.length >= 4) {
        return [null, withoutQuery(parts[3])];
    }
    return [null, null];
}

/** Strips a model title down to something a filesystem accepts, for the 'Save as' suggestion.
 *
 * The legacy version (utiltab.js:576) turns every offending character into a dash, which renders a
 * title like 'Juggernaut XL (Hyper) - v9.0' as 'Juggernaut_XL_-Hyper-_-_v9-0'. Decoration is
 * dropped instead, and only the characters that carry meaning in a path become separators. The
 * server sanitizes this again either way (StrictFilenameClean, Utilities.cs:185). */
export function cleanSaveName(title: string): string {
    return title
        .replace(/["'()[\]{}!,]/g, '')
        // Characters the server would strip from a filename (Utilities.cs:161), plus the '/' that
        // would otherwise quietly create a folder and the '.' the server deletes outright.
        .replace(/[<>:\\|?*~&@;#$^/.]+/g, '-')
        .replace(/\s+/g, '_')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '');
}

/** File names Hugging Face repos give to "the model in this repo", which say nothing at all once
 *  the file is sitting in a folder beside other models. */
const GENERIC_HF_NAMES = ['model', 'pytorch_model', 'diffusion_pytorch_model'];

function huggingFaceName(repo: string, filePath: string): string {
    const leaf = withoutExtension(filePath.split('/').pop() ?? '');
    const stem = leaf.replace(/-\d{5}-of-\d{5}$/, '');
    return GENERIC_HF_NAMES.includes(stem.toLowerCase()) ? repo : leaf;
}

function resolveHuggingFace(url: string): ModelSource {
    // org, repo, 'blob' | 'resolve', branch, file path (which may hold further slashes).
    const parts = splitWithTail(url.slice(HF_PREFIX.length), '/', 5);
    if (parts.length < 5) {
        return source('hfNotAFile');
    }
    if (parts[4].endsWith('?download=true')) {
        parts[4] = parts[4].slice(0, -'?download=true'.length);
    }
    if (!hasExtension(parts[4], SAFE_EXTENSIONS)) {
        return source('hfNotSafetensors');
    }
    const suggestedName = huggingFaceName(parts[1], parts[4]);
    if (parts[2] === 'blob' || parts[2] === 'resolve') {
        // 'blob' is the page a browser lands on; 'resolve' is the same file as a download.
        const corrected = [...parts];
        corrected[2] = 'resolve';
        return source(parts[2] === 'blob' ? 'hfCorrected' : 'hfValid', {
            ok: true,
            downloadUrl: `${HF_PREFIX}${corrected.join('/')}`,
            suggestedName
        });
    }
    return source('hfUnclear', { ok: true, downloadUrl: url, suggestedName });
}

/** Minimal shapes of the Civitai API responses this reads. */
interface CivitaiFileData {
    name: string;
    type?: string;
    downloadUrl?: string;
    sizeKB?: number;
}

interface CivitaiVersionData {
    id: number;
    name: string;
    baseModel?: string;
    createdAt?: string;
    description?: string;
    trainedWords?: string[];
    files?: CivitaiFileData[];
    images?: { url: string; type: string }[];
}

interface CivitaiModelData {
    id: number;
    name: string;
    type?: string;
    description?: string;
    creator?: { username?: string };
    tags?: string[];
    modelVersions?: CivitaiVersionData[];
}

/** One Civitai API call through the server's proxy. Answers null for anything that went wrong —
 *  a bad id, a rate limit and an outage all leave the caller with the same "no metadata". */
async function civitaiGet<T>(path: string): Promise<T | null> {
    try {
        const result = await api.post<{ response?: T }>('ForwardMetadataRequest', {
            url: `${CIVITAI_PREFIX}${path}`
        });
        return result.response ?? null;
    }
    catch {
        return null;
    }
}

/** Picks the file to download out of a model's versions: the requested version where there is one,
 *  otherwise the newest version that actually holds a model file. */
function pickVersionFile(
    model: CivitaiModelData,
    versionId: string | null
): { version: CivitaiVersionData; file: CivitaiFileData } | null {
    const versions = model.modelVersions ?? [];
    for (const version of versions) {
        for (const file of version.files ?? []) {
            if (CIVITAI_SIDE_FILES.includes(file.type ?? '')) {
                continue;
            }
            if (!hasExtension(file.name, SAFE_EXTENSIONS)) {
                continue;
            }
            if (versionId && !withoutQuery(file.downloadUrl ?? '').endsWith(`/${versionId}`)) {
                continue;
            }
            return { version, file };
        }
    }
    const fallback = versions[0];
    const file = fallback?.files?.[0];
    return fallback && file ? { version: fallback, file } : null;
}

async function resolveCivitai(url: string, canLookup: boolean): Promise<ModelSource> {
    let [modelId, versionId] = parseCivitaiUrl(url);
    if (!modelId && !versionId) {
        return source('civitaiNotAModel');
    }
    // A direct download link is usable on its own; the lookup only adds metadata to it.
    const directUrl = versionId ? `${CIVITAI_PREFIX}api/download/models/${versionId}` : '';
    if (!canLookup) {
        return versionId
            ? source('civitaiNoLookup', { ok: true, downloadUrl: directUrl })
            : source('civitaiNoLookup');
    }
    if (!modelId && versionId) {
        const version = await civitaiGet<{ modelId?: number }>(`api/v1/model-versions/${versionId}`);
        if (!version?.modelId) {
            return source('civitaiFailed', { ok: Boolean(directUrl), downloadUrl: directUrl });
        }
        modelId = `${version.modelId}`;
    }
    const model = await civitaiGet<CivitaiModelData>(`api/v1/models/${modelId}`);
    const picked = model ? pickVersionFile(model, versionId) : null;
    if (!model || !picked) {
        return source('civitaiFailed', { ok: Boolean(directUrl), downloadUrl: directUrl });
    }
    const { version, file } = picked;
    if (!hasExtension(file.name, SAFE_EXTENSIONS)) {
        return source('civitaiUnsafeFile', { detail: file.name });
    }
    versionId ??= `${version.id}`;
    const pageUrl = `${CIVITAI_PREFIX}models/${modelId}?modelVersionId=${versionId}`;
    const metadata: Record<string, string> = {
        'modelspec.title': `${model.name} - ${version.name}`,
        // Kept byte-identical to the legacy build, links and all, so a model downloaded from either
        // UI carries the same description text.
        'modelspec.description': `From <a href="${pageUrl}" target="_blank">${pageUrl}</a>\n${version.description || ''}\n${model.description || ''}\n`,
        'modelspec.date': version.createdAt ?? ''
    };
    if (model.creator?.username) {
        metadata['modelspec.author'] = model.creator.username;
    }
    if (version.trainedWords?.length) {
        metadata['modelspec.trigger_phrase'] = version.trainedWords.join('; ');
    }
    if (model.tags?.length) {
        metadata['modelspec.tags'] = model.tags.join(', ');
    }
    if (HINTED_BASE_MODELS.includes(version.baseModel ?? '')) {
        metadata['modelspec.usage_hint'] = version.baseModel ?? '';
    }
    const previews: Preview[] = (version.images ?? [])
        .filter(image => image.type === 'image' || image.type === 'video')
        .map(image => ({ url: image.url, kind: image.type === 'video' ? 'video' : 'image' }));
    return source('civitaiLoaded', {
        ok: true,
        // The '#.gguf' marker is how the server is told the format; it strips the fragment before
        // fetching (ModelsAPI.cs:599).
        downloadUrl: hasExtension(file.name, ['.gguf'])
            ? `${file.downloadUrl}#.gguf`
            : (file.downloadUrl ?? directUrl),
        suggestedName: cleanSaveName(`${model.name} - ${version.name}`),
        subtype: CIVITAI_SUBTYPES[model.type ?? ''] ?? null,
        metadata,
        civitai: {
            modelId: `${model.id}`,
            versionId,
            modelName: model.name,
            versionName: version.name,
            baseModel: version.baseModel ?? '',
            date: version.createdAt ?? '',
            author: model.creator?.username ?? '',
            triggerWords: (version.trainedWords ?? []).join('; '),
            fileName: file.name,
            fileSizeKb: file.sizeKB ?? null,
            description: stripHtml(model.description ?? ''),
            versionDescription: stripHtml(version.description ?? ''),
            pageUrl,
            previews
        }
    });
}

/** Works out what a pasted link points at, and what should be downloaded from it.
 *
 * `canLookup` is the user's `edit_model_metadata` permission, which is what gates the metadata
 * proxy (ModelsAPI.cs:35). Without it a Civitai link still downloads, just without its metadata. */
export async function resolveModelSource(rawUrl: string, canLookup: boolean): Promise<ModelSource> {
    const url = normalizeCivitaiUrl(rawUrl);
    if (url === '') {
        return source('empty');
    }
    if (hasExtension(url, PICKLE_EXTENSIONS)) {
        return source('pickle');
    }
    if (url.startsWith(HF_PREFIX)) {
        return resolveHuggingFace(url);
    }
    if (url.startsWith(CIVITAI_PREFIX)) {
        return resolveCivitai(url, canLookup);
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return source('notALink');
    }
    const leaf = withoutQuery(url).split('/').filter(Boolean).pop() ?? '';
    return source('direct', {
        ok: true,
        downloadUrl: url,
        suggestedName: hasExtension(leaf, SAFE_EXTENSIONS) ? withoutExtension(leaf) : ''
    });
}

/** The text of an HTML fragment. Civitai descriptions are HTML, and only their text is shown here,
 *  so the markup never reaches the DOM. */
export function stripHtml(html: string): string {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return (parsed.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Every folder that already holds a model of one subtype, nested paths included.
 *
 * The legacy folder dropdown (utiltab.js:203) builds this from every subtype at once, so it offers
 * LoRA folders as places to put a VAE. Scoping it to the chosen subtype is the same list, minus
 * the entries that cannot apply. */
export function folderOptions(modelNames: string[]): string[] {
    const folders = new Set<string>();
    for (const name of modelNames) {
        const parts = name.split('/');
        for (let i = 1; i < parts.length; i++) {
            folders.add(parts.slice(0, i).join('/'));
        }
    }
    return [...folders].sort((a, b) => a.localeCompare(b));
}

/** Roughly 256x256, the size the legacy downloader saves thumbnails at. */
const THUMBNAIL_PIXELS = 256 * 256;

function toThumbnailDataUrl(
    frame: HTMLImageElement | HTMLVideoElement,
    width: number,
    height: number
): string | null {
    if (!width || !height) {
        return null;
    }
    // Never upscale: a small preview stays small rather than being blown up into a bigger file.
    const ratio = Math.min(1, Math.sqrt(THUMBNAIL_PIXELS / (width * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
    try {
        return canvas.toDataURL('image/jpeg');
    }
    catch {
        // The host refused CORS, so the canvas is tainted and cannot be read back.
        return null;
    }
}

function imageThumbnail(url: string): Promise<string | null> {
    return new Promise(resolve => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(toThumbnailDataUrl(image, image.width, image.height));
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

function videoThumbnail(url: string): Promise<string | null> {
    return new Promise(resolve => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        video.muted = true;
        video.onloadedmetadata = () => {
            // Seeking off zero is what actually forces a frame to be decoded.
            video.currentTime = 0.001;
        };
        video.onseeked = () => resolve(toThumbnailDataUrl(video, video.videoWidth, video.videoHeight));
        video.onerror = () => resolve(null);
        video.src = url;
    });
}

/** Shrinks a preview into a data URL for embedding as the model's thumbnail. Mirrors
 *  imageToData(..., resize256) (src/wwwroot/js/util.js:916), including the legacy downloader's
 *  first-frame grab for models whose only previews are videos. Null means it could not be read. */
export function previewToThumbnail(preview: Preview): Promise<string | null> {
    return preview.kind === 'video' ? videoThumbnail(preview.url) : imageThumbnail(preview.url);
}
