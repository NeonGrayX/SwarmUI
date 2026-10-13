/** Bulk Civitai metadata scan: for each local model, find its Civitai page and fill in the model's
 *  metadata (title, author, description, thumbnail, ...) from it.
 *
 * Port of legacy's ModelMetadataScanner (src/wwwroot/js/genpage/utiltab.js). It runs entirely in
 * the browser, one DescribeModel + Civitai lookup + EditModelMetadata per model, so the page has to
 * stay open while it runs. The Civitai page is found from the link a Swarm download writes at the
 * top of the description, or failing that by the model's hash.
 */

import { api } from '@/api/client';
import type { ModelCard } from '@/library/types';
import { civitaiGet, previewToThumbnail, resolveModelSource } from './modelSource';

export type ScanDateRange = 'all' | 'today' | 'week' | 'month';
export type ScanFilter = 'all' | 'no_thumbnail' | 'no_description' | 'no_author' | 'explicit_url';
export type ScanReplace = 'only_missing' | 'all' | 'only_thumbnail' | 'only_text';

export const SCAN_DATE_RANGES: ScanDateRange[] = ['all', 'today', 'week', 'month'];
export const SCAN_FILTERS: ScanFilter[] = ['all', 'no_thumbnail', 'no_description', 'no_author', 'explicit_url'];
export const SCAN_REPLACES: ScanReplace[] = ['only_missing', 'all', 'only_thumbnail', 'only_text'];

export interface ScanOptions {
    dateRange: ScanDateRange;
    filter: ScanFilter;
    replace: ScanReplace;
    /** Filename filter, `*` as wildcard, case-insensitive. Empty matches everything. */
    nameFilter: string;
}

export interface ScanProgress {
    total: number;
    running: number;
    /** Found on Civitai and compared. */
    scanned: number;
    /** Not found on Civitai, or a request failed. */
    failed: number;
    /** Excluded by the date range or filter. */
    skipped: number;
    /** Actually had new metadata written. */
    updated: number;
}

/** As legacy: enough parallelism to get through a big library, few enough not to swamp Civitai. */
const MAX_SIMULTANEOUS = 30;

const PLACEHOLDER_PREVIEW = 'imgs/model_placeholder.jpg';
const EMPTY_DESCRIPTIONS = ['', '(None)', '(Unset)'];
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_MS: Record<Exclude<ScanDateRange, 'all'>, number> = {
    today: DAY_MS,
    week: 7 * DAY_MS,
    month: 31 * DAY_MS
};

/** Legacy's simpleAsteriskedMatcher (src/wwwroot/js/util.js). */
function asteriskMatcher(pattern: string): (text: string) => boolean {
    const parts = pattern.toLowerCase().split('*');
    return raw => {
        const text = raw.toLowerCase();
        if (!text.startsWith(parts[0]) || !text.endsWith(parts[parts.length - 1])) {
            return false;
        }
        let index = 0;
        for (const part of parts) {
            const found = text.indexOf(part, index);
            if (found < 0) {
                return false;
            }
            index = found + part.length;
        }
        return true;
    };
}

/** The Civitai page a Swarm download wrote into the description, or ''. Legacy getCivitUrlGuessFor
 *  (src/wwwroot/js/genpage/gentab/models.js). */
function civitaiUrlFromDescription(description: string | null): string {
    if (!description) {
        return '';
    }
    let start = description.indexOf('<a href="https://civitai.red/models/');
    if (start === -1) {
        start = description.indexOf('<a href="https://civitai.com/models/');
    }
    if (start === -1) {
        return '';
    }
    start += '<a href="'.length;
    const end = description.indexOf('"', start);
    if (end === -1) {
        return '';
    }
    let url = description.substring(start, end);
    if (url.startsWith('https://civitai.com/')) {
        url = `https://civitai.red/${url.substring('https://civitai.com/'.length)}`;
    }
    if (!url.includes('?modelVersionId=') || url.length > 200 || url.includes('?modelVersionId=null')) {
        return '';
    }
    return url;
}

async function civitaiUrlFromHash(model: ModelCard, type: string): Promise<string> {
    let hash = model.hash;
    if (!hash) {
        hash = (await api.post<{ hash: string }>('GetModelHash', { modelName: model.name, subtype: type })).hash;
    }
    if (!hash) {
        return '';
    }
    if (hash.startsWith('0x')) {
        hash = hash.substring(2);
    }
    const found = await civitaiGet<{ modelId?: number; id?: number; error?: string }>(
        `api/v1/model-versions/by-hash/${hash.substring(0, 12)}`
    );
    if (!found || found.error || !found.modelId || !found.id) {
        return '';
    }
    return `https://civitai.red/models/${found.modelId}?modelVersionId=${found.id}`;
}

function hasPreview(model: ModelCard): boolean {
    return Boolean(model.preview_image) && model.preview_image !== PLACEHOLDER_PREVIEW;
}

function passesFilter(model: ModelCard, filter: ScanFilter, explicitUrl: string): boolean {
    switch (filter) {
        case 'no_thumbnail':
            return !hasPreview(model);
        case 'no_description':
            return EMPTY_DESCRIPTIONS.includes((model.description ?? '').trim());
        case 'no_author':
            return !model.author;
        case 'explicit_url':
            return explicitUrl !== '';
        default:
            return true;
    }
}

type Outcome = 'skipped' | 'failed' | 'unchanged' | 'updated';

async function scanOne(entry: { name: string; type: string }, options: ScanOptions, now: number): Promise<Outcome> {
    const { model } = await api.post<{ model: ModelCard }>('DescribeModel', {
        modelName: entry.name,
        subtype: entry.type
    });
    if (options.dateRange !== 'all' && now - model.time_created > RANGE_MS[options.dateRange]) {
        return 'skipped';
    }
    let url = civitaiUrlFromDescription(model.description);
    if (!passesFilter(model, options.filter, url)) {
        return 'skipped';
    }
    if (!url) {
        url = await civitaiUrlFromHash(model, entry.type);
        if (!url) {
            return 'failed';
        }
    }
    const resolved = await resolveModelSource(url, true);
    const meta = resolved.metadata;
    if (!meta || !resolved.civitai) {
        return 'failed';
    }
    const wantsImage = options.replace === 'all' || options.replace === 'only_thumbnail' || (options.replace === 'only_missing' && !hasPreview(model));
    const firstPreview = resolved.civitai.previews[0];
    const image = wantsImage && firstPreview ? await previewToThumbnail(firstPreview) : null;

    const before = {
        title: model.title ?? '',
        description: model.description ?? '',
        author: model.author ?? '',
        date: model.date ?? '',
        trigger_phrase: model.trigger_phrase ?? '',
        usage_hint: model.usage_hint ?? '',
        tags: model.tags?.join(', ') ?? ''
    };
    const after = { ...before };
    const fields = ['title', 'description', 'author', 'date', 'trigger_phrase', 'usage_hint'] as const;
    const civitaiTags = meta['modelspec.tags'] ? meta['modelspec.tags'].split(',').map(tag => tag.trim()).join(', ') : '';
    if (options.replace === 'all' || options.replace === 'only_text') {
        for (const field of fields) {
            after[field] = meta[`modelspec.${field}`] || after[field];
        }
        after.tags = civitaiTags || after.tags;
    }
    else if (options.replace === 'only_missing') {
        for (const field of fields) {
            after[field] = after[field] || meta[`modelspec.${field}`] || '';
        }
        after.tags = after.tags || civitaiTags;
    }
    const textChanged = (Object.keys(before) as (keyof typeof before)[]).some(key => before[key] !== after[key]);
    if (!textChanged && !image) {
        return 'unchanged';
    }
    await api.post('EditModelMetadata', {
        model: entry.name,
        subtype: entry.type,
        title: after.title,
        author: after.author,
        type: model.architecture ?? '',
        description: after.description,
        standard_width: model.standard_width || 0,
        standard_height: model.standard_height || 0,
        date: after.date,
        license: model.license ?? '',
        trigger_phrase: after.trigger_phrase,
        usage_hint: after.usage_hint,
        prediction_type: model.prediction_type ?? '',
        tags: after.tags || null,
        // Empty leaves the stored preview alone; only a fresh thumbnail is sent.
        preview_image: image ?? '',
        is_negative_embedding: model.is_negative_embedding,
        lora_default_weight: model.lora_default_weight || '',
        lora_default_confinement: model.lora_default_confinement || ''
    });
    return 'updated';
}

/** Runs the scan over `models`, reporting progress as it goes. Resolves once every started lookup
 *  has finished; `shouldStop` is checked before each new one, so stopping lets the running ones
 *  complete rather than abandoning half-written edits. */
export async function runMetadataScan(
    models: { name: string; type: string }[],
    options: ScanOptions,
    onProgress: (progress: ScanProgress) => void,
    shouldStop: () => boolean
): Promise<ScanProgress> {
    const matches = asteriskMatcher(options.nameFilter.trim());
    const list = models.filter(model => model.name !== '(None)' && matches(model.name));
    const progress: ScanProgress = { total: list.length, running: 0, scanned: 0, failed: 0, skipped: 0, updated: 0 };
    const report = () => onProgress({ ...progress });
    const now = Date.now();
    let next = 0;

    async function worker(): Promise<void> {
        while (next < list.length && !shouldStop()) {
            const entry = list[next++];
            progress.running++;
            report();
            try {
                const outcome = await scanOne(entry, options, now);
                if (outcome === 'skipped') {
                    progress.skipped++;
                }
                else if (outcome === 'failed') {
                    progress.failed++;
                }
                else {
                    progress.scanned++;
                    if (outcome === 'updated') {
                        progress.updated++;
                    }
                }
            }
            catch {
                progress.failed++;
            }
            progress.running--;
            report();
        }
    }

    report();
    await Promise.all(Array.from({ length: Math.min(MAX_SIMULTANEOUS, list.length) }, worker));
    return progress;
}
