/** Shapes for the Library browsers.
 *  Mirrors T2IModel.ToNetObject (src/Text2Image/T2IModel.cs) and the ListModels / ListImages
 *  responses in src/WebAPI/ModelsAPI.cs and src/WebAPI/T2IAPI.cs. */

/** Model subtypes the server exposes. 'Wildcards' is handled specially by ListModels. */
export type ModelSubtype =
    | 'Stable-Diffusion'
    | 'LoRA'
    | 'VAE'
    | 'Embedding'
    | 'ControlNet'
    | 'Clip'
    | 'ClipVision'
    | 'Wildcards';

export interface ModelCard {
    name: string;
    title: string | null;
    author: string | null;
    description: string | null;
    preview_image: string | null;
    /** True when at least one backend currently has it loaded. */
    loaded: boolean;
    architecture: string | null;
    class: string | null;
    compat_class: string | null;
    resolution: string | null;
    standard_width: number;
    standard_height: number;
    license: string | null;
    date: string | null;
    prediction_type: string | null;
    usage_hint: string | null;
    trigger_phrase: string | null;
    merged_from: string | null;
    tags: string[] | null;
    is_supported_model_format: boolean;
    is_negative_embedding: boolean;
    lora_default_weight: string;
    lora_default_confinement: string;
    local: boolean;
    time_created: number;
    time_modified: number;
    hash: string;
    special_format: string;
}

/** Wildcards use a different, smaller shape (WildcardsHelper.GetNetObject). */
export interface WildcardCard {
    name: string;
    raw: string;
    image: string | null;
}

export interface ListModelsResponse {
    folders: string[];
    files: (ModelCard | WildcardCard)[];
}

export interface ImageEntry {
    src: string;
    metadata: string | null;
}

export interface ListImagesResponse {
    folders: string[];
    files: ImageEntry[];
}

export interface PresetEntry {
    title: string;
    description: string;
    preview_image?: string;
    param_map?: Record<string, unknown>;
    is_edited?: boolean;
}

export interface MyUserData {
    user_name: string;
    presets: PresetEntry[];
    language: string;
    permissions: string[];
    /** Keyed by subtype, eg { 'LoRA': ['one', 'two'] }. */
    starred_models: Record<string, string[]>;
    /** Presets linked to a model, keyed by subtype then cleaned model name, eg
     *  { 'LoRA': { 'some/lora': ['Preset Title'] } }. Written whole by SetPresetLinks. */
    model_preset_links: Record<string, Record<string, string[]>>;
    autocompletions: string[] | null;
}

export type SortMode = 'Name' | 'Title' | 'DateCreated' | 'DateModified';

/** ListImages sorts by far less than ListModels does - those two modes are all it parses
 *  (ImageHistorySortMode, used by T2IAPI.ListImages). */
export type ImageSortMode = 'Name' | 'Date';
export type ViewMode = 'grid' | 'list';

/** How a Library browser lays its entries out. The legacy browsers' display formats
 *  (src/wwwroot/js/genpage/helpers/browsers.js), minus the variants that only differ in size steps
 *  nobody could tell apart. */
export type BrowserFormat = 'cards' | 'smallCards' | 'bigCards' | 'thumbnails' | 'smallThumbnails' | 'list';

export const BROWSER_FORMATS: readonly BrowserFormat[] = [
    'cards',
    'smallCards',
    'bigCards',
    'thumbnails',
    'smallThumbnails',
    'list'
];

/** True when the entry is a full model card rather than a wildcard. */
export function isModelCard(entry: ModelCard | WildcardCard): entry is ModelCard {
    return 'preview_image' in entry;
}

/** True when an image's metadata records it as starred.
 *
 * Starring copies the file into `Starred/` rather than editing it in place, so the folder an image
 * is listed under says nothing about its state - a starred `raw/` image stays in `raw/`. The server
 * flags both copies (OutputMetadataTracker.cs:409), so reading the flag is the only answer that
 * holds whichever folder the browser is pointed at. */
export function isImageStarred(metadata: string | null | undefined): boolean {
    return parseStarred(metadata);
}

/** Starred flags already read, per listing entry. Entries are replaced rather than edited when
 *  their metadata changes (editCachedImages in ./hooks.ts), so an entry object's answer never goes
 *  stale, and one that has left every listing is free to be collected. */
const starredCache = new WeakMap<ImageEntry, boolean>();

/** `isImageStarred` for a listing entry, parsing each entry's metadata at most once. */
export function isEntryStarred(entry: ImageEntry): boolean {
    let starred = starredCache.get(entry);
    if (starred === undefined) {
        starred = parseStarred(entry.metadata);
        starredCache.set(entry, starred);
    }
    return starred;
}

function parseStarred(metadata: string | null | undefined): boolean {
    if (!metadata) {
        return false;
    }
    try {
        return (JSON.parse(metadata) as { is_starred?: boolean }).is_starred === true;
    }
    catch {
        return false;
    }
}

/** Metadata sections whose entries a history search can hit as `key: value`. */
const SEARCHED_SECTIONS = ['sui_image_params', 'sui_extra_data'];

function searchValue(value: unknown): string {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/** Everything a history search is matched against, lowercased: the path, the raw metadata, and a
 *  `key: value` line per generation parameter and extra-data entry, one per item for lists. So
 *  `model: sdxl` finds what was made with that model, and `loras: detail` what used that LoRA.
 *
 *  The same text legacy searches (describeOutputFile, src/wwwroot/js/genpage/gentab/outputhistory.js)
 *  and the same lines the server's `filter` matches (ImageHistoryMatchesFilter, src/WebAPI/T2IAPI.cs),
 *  so a server-side search and the local one agree on what counts as a hit. */
export function imageSearchText(entry: ImageEntry): string {
    let text = searchTextCache.get(entry);
    if (text === undefined) {
        text = buildSearchText(entry);
        searchTextCache.set(entry, text);
    }
    return text;
}

/** Search text already built, per listing entry - see `starredCache`. */
const searchTextCache = new WeakMap<ImageEntry, string>();

function buildSearchText(entry: ImageEntry): string {
    const lines = [entry.src, entry.metadata ?? ''];
    try {
        const parsed = JSON.parse(entry.metadata ?? '') as Record<string, unknown>;
        for (const section of SEARCHED_SECTIONS) {
            const values = parsed?.[section];
            if (typeof values !== 'object' || values === null || Array.isArray(values)) {
                continue;
            }
            for (const [key, value] of Object.entries(values)) {
                for (const item of Array.isArray(value) ? value : [value]) {
                    lines.push(`${key}: ${searchValue(item)}`);
                }
            }
        }
    }
    catch {
        // Not JSON: the raw text above is all there is to search.
    }
    return lines.join('\n').toLowerCase();
}

/** The stand-in image the server reports for a model or wildcard that has no preview of its own. */
export function isPlaceholderImage(src: string | null | undefined): boolean {
    return !src || src.endsWith('imgs/model_placeholder.jpg');
}

/** Resolves a preview image path to something an <img> can load. */
export function previewUrl(src: string | null | undefined): string | undefined {
    if (!src) {
        return undefined;
    }
    if (src.startsWith('data:') || src.startsWith('http')) {
        return src;
    }
    return `/${src.replace(/^\//, '')}`;
}

/** Prefix for output-image paths returned by ListImages.
 *
 * Those paths are relative to the *user's* output directory, so the route depends on whether the
 * server appends the username to the output path: `View/<user_id>` when it does, `Output` when it
 * does not. Mirrors getImageOutPrefix (src/wwwroot/js/site.js:10). */
export function imageOutPrefix(userId: string | undefined, appendUser: boolean | undefined): string {
    return appendUser && userId ? `View/${userId}` : 'Output';
}
