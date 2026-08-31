/** Turning a pasted link into a downloadable model.
 *
 * Ported from ModelDownloaderUtil (src/wwwroot/js/genpage/utiltab.js:174): how a Civitai or
 * HuggingFace *page* link maps to a direct download link, and how to read a model's metadata off
 * the Civitai API — proxied through `ForwardMetadataRequest`, because the browser cannot reach
 * civitai.red itself.
 *
 * A link resolves to one `ResolvedSource` describing everything the form needs to show and send.
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
 *  (ApplyDownloadAPIKey, src/Utils/Utilities.cs:739), but the API calls made here have to be aimed
 *  at the canonical host. */
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

/** Civitai files that ride along with a model rather than being it, so they are never what a link
 *  is taken to mean. A VAE can still be picked deliberately from the file list; a text encoder is
 *  not a model at all, so it is not offered there either. */
const CIVITAI_SIDE_FILES = ['Text Encoder', 'VAE'];
const CIVITAI_NON_MODEL_FILES = ['Text Encoder'];

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

/** One selectable alternative behind a Civitai link. */
export interface CivitaiOption {
    id: string;
    label: string;
}

/** A downloadable file, which is shown with its size where Civitai states one. */
export interface CivitaiFileOption extends CivitaiOption {
    sizeKb: number | null;
}

/** A version and file picked out of what the link's model offers, overriding what the link itself
 *  points at. Both are Civitai ids. */
export interface CivitaiChoice {
    versionId?: string;
    fileId?: string;
}

/** What the Civitai API knows about the model behind the link, in display form. */
export interface CivitaiInfo {
    modelId: string;
    versionId: string;
    modelName: string;
    versionName: string;
    /** Every version of the model, newest first, as the version picker lists them. */
    versions: CivitaiOption[];
    /** Files of the chosen version that can actually be downloaded, as the file picker lists them.
     *  One entry means there is nothing to pick between. */
    files: CivitaiFileOption[];
    /** Id of the file within `files` that this source downloads. */
    fileId: string;
    /** When early access to this version ends, or null when it is freely downloadable. */
    paidAccessEndsAt: string | null;
    baseModel: string;
    date: string;
    author: string;
    /** Trained words, already joined for display. */
    triggerWords: string;
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
 *  Decoration is dropped rather than turned into separators, and only characters that carry
 *  meaning in a path become one. The server sanitizes this again either way (StrictFilenameClean,
 *  src/Utils/Utilities.cs:187). */
export function cleanSaveName(title: string): string {
    return title
        .replace(/["'()[\]{}!,]/g, '')
        // Characters the server would strip from a filename (FilePathForbidden,
        // src/Utils/Utilities.cs:163), plus the '/' that would otherwise quietly create a folder
        // and the '.' the server deletes outright.
        .replace(/[<>:\\|?*~&@;#$^%/.]+/g, '-')
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
    id: number;
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
    /** Present on early-access versions, which only paying accounts can download until it lapses. */
    paidAccess?: { endsAt?: string };
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

/** Answers already had from the Civitai API, so that picking a different version or file of a
 *  model the form has just described re-resolves off the response already in hand instead of
 *  asking for the same model again. Capped, since a session can paste any number of links. */
const CIVITAI_CACHE = new Map<string, Promise<unknown>>();
const CIVITAI_CACHE_LIMIT = 16;

/** One Civitai API call through the server's proxy. Answers null for anything that went wrong —
 *  a bad id, a rate limit and an outage all leave the caller with the same "no metadata". */
function civitaiGet<T>(path: string): Promise<T | null> {
    const cached = CIVITAI_CACHE.get(path);
    if (cached) {
        return cached as Promise<T | null>;
    }
    const request = api
        .post<{ response?: T }>('ForwardMetadataRequest', { url: `${CIVITAI_PREFIX}${path}` })
        .then(result => result.response ?? null)
        .catch(() => {
            // A failure is not worth remembering: the next attempt may well be past the rate limit
            // or the outage that caused it.
            CIVITAI_CACHE.delete(path);
            return null;
        });
    if (CIVITAI_CACHE.size >= CIVITAI_CACHE_LIMIT) {
        // Map iterates in insertion order, so this drops the least recently added entry.
        CIVITAI_CACHE.delete(CIVITAI_CACHE.keys().next().value as string);
    }
    CIVITAI_CACHE.set(path, request);
    return request;
}

/** Files of a version the downloader can fetch: model files in a format the server accepts. A text
 *  encoder ships beside a model rather than being one, so it is never listed; a VAE is, because a
 *  model page is a legitimate place to get one from even though a bare link never means it. */
function offeredFiles(version: CivitaiVersionData): CivitaiFileData[] {
    return (version.files ?? []).filter(
        file =>
            !CIVITAI_NON_MODEL_FILES.includes(file.type ?? '') &&
            hasExtension(file.name, SAFE_EXTENSIONS)
    );
}

/** The file a version means when nothing has been picked. Falls back to whatever the version holds
 *  first, so an unusable file still gets named in the 'not a safetensors' message. */
function defaultFile(version: CivitaiVersionData): CivitaiFileData | null {
    const offered = offeredFiles(version);
    return (
        offered.find(file => !CIVITAI_SIDE_FILES.includes(file.type ?? '')) ??
        offered[0] ??
        version.files?.[0] ??
        null
    );
}

/** Picks the version a link points at: the one it names, or — since a link may carry a download id
 *  rather than a version id, and a version may hold no model file at all — the newest that has
 *  something worth downloading. */
function pickVersion(model: CivitaiModelData, versionId: string | null): CivitaiVersionData | null {
    const versions = model.modelVersions ?? [];
    if (versionId) {
        const named = versions.find(version => `${version.id}` === versionId);
        if (named) {
            return named;
        }
        // An /api/download/models/<id> link names its version only inside the file's download URL.
        const byDownload = versions.find(version =>
            offeredFiles(version).some(file =>
                withoutQuery(file.downloadUrl ?? '').endsWith(`/${versionId}`)
            )
        );
        if (byDownload) {
            return byDownload;
        }
    }
    return versions.find(version => offeredFiles(version).length > 0) ?? versions[0] ?? null;
}

async function resolveCivitai(
    url: string,
    canLookup: boolean,
    choice: CivitaiChoice
): Promise<ModelSource> {
    let [modelId, linkVersionId] = parseCivitaiUrl(url);
    if (!modelId && !linkVersionId) {
        return source('civitaiNotAModel');
    }
    // A picked version wins over the one the pasted link names, since it is the later statement of
    // what the user wants out of the same model.
    let versionId = choice.versionId ?? linkVersionId;
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
    const version = model ? pickVersion(model, versionId) : null;
    if (!model || !version) {
        return source('civitaiFailed', { ok: Boolean(directUrl), downloadUrl: directUrl });
    }
    const offered = offeredFiles(version);
    // A picked file is taken as meant even when it is a VAE or some other extra a bare link would
    // never resolve to; without one, the version's own model file is what the link meant.
    const file =
        (choice.fileId ? offered.find(entry => `${entry.id}` === choice.fileId) : null) ??
        defaultFile(version);
    if (!file) {
        return source('civitaiFailed', { ok: Boolean(directUrl), downloadUrl: directUrl });
    }
    if (!hasExtension(file.name, SAFE_EXTENSIONS)) {
        return source('civitaiUnsafeFile', { detail: file.name });
    }
    versionId = `${version.id}`;
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
        // fetching (ModelsAPI.cs:608).
        downloadUrl: hasExtension(file.name, ['.gguf'])
            ? `${file.downloadUrl}#.gguf`
            : (file.downloadUrl ?? directUrl),
        suggestedName: cleanSaveName(`${model.name} - ${version.name}`),
        // A file states its own kind when it is not simply 'the model' - a VAE listed under a
        // checkpoint is a VAE - so that beats the model's overall type.
        subtype: CIVITAI_SUBTYPES[file.type && file.type !== 'Model' ? file.type : (model.type ?? '')] ?? null,
        metadata,
        civitai: {
            modelId: `${model.id}`,
            versionId,
            modelName: model.name,
            versionName: version.name,
            versions: (model.modelVersions ?? []).map(entry => ({
                id: `${entry.id}`,
                label: entry.name
            })),
            // The chosen file is listed even when it would not have been offered - a version
            // holding nothing but a text encoder resolves to it, and the card still has to name
            // what is about to be downloaded.
            files: (offered.includes(file) ? offered : [file, ...offered]).map(entry => ({
                id: `${entry.id}`,
                label: entry.name,
                sizeKb: entry.sizeKB ?? null
            })),
            fileId: `${file.id}`,
            paidAccessEndsAt: futureDate(version.paidAccess?.endsAt),
            baseModel: version.baseModel ?? '',
            date: version.createdAt ?? '',
            author: model.creator?.username ?? '',
            triggerWords: (version.trainedWords ?? []).join('; '),
            description: stripHtml(model.description ?? ''),
            versionDescription: stripHtml(version.description ?? ''),
            pageUrl,
            previews
        }
    });
}

/** A date that has not passed yet, or null. An early-access window that has already lapsed says
 *  nothing about downloading the model today. */
function futureDate(value: string | undefined): string | null {
    if (!value) {
        return null;
    }
    const when = new Date(value);
    return Number.isFinite(when.getTime()) && when > new Date() ? value : null;
}

/** Works out what a pasted link points at, and what should be downloaded from it.
 *
 * `canLookup` is the user's `edit_model_metadata` permission, which is what gates the metadata
 * proxy (ModelsAPI.cs:35). Without it a Civitai link still downloads, just without its metadata.
 *
 * `choice` is the version and file picked out of a Civitai model after it first resolved, which is
 * only ever set for a link that already resolved to that same model. */
export async function resolveModelSource(
    rawUrl: string,
    canLookup: boolean,
    choice: CivitaiChoice = {}
): Promise<ModelSource> {
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
        return resolveCivitai(url, canLookup, choice);
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

/** Every folder that already holds a model of one subtype, nested paths included. Scoped to the
 *  chosen subtype, so the picker never offers a LoRA folder as a place to put a VAE. */
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

/** Roughly 256x256, the size model thumbnails are saved at. */
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

/** Shrinks a preview into a data URL for embedding as the model's thumbnail, grabbing the first
 *  frame for models whose only previews are videos. Null means it could not be read. */
export function previewToThumbnail(preview: Preview): Promise<string | null> {
    return preview.kind === 'video' ? videoThumbnail(preview.url) : imageThumbnail(preview.url);
}
