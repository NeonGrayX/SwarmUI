/** Turns the metadata blob stored on an image into labelled, readable rows.
 *
 * Images carry `{"sui_image_params": {...}, "sui_extra_data": {...}, "sui_models": [...]}`
 * (GenFullMetadataObject, src/Text2Image/T2IParamInput.cs:406). Raw, that reads as a wall of
 * JSON with ids like `cfgscale` in it; here the param schema supplies real names, descriptions
 * and value labels, and the rows are grouped the way the panel shows them.
 *
 * The regrouping mirrors getFormattedMetadataEntries
 * (src/wwwroot/js/genpage/helpers/metadatahelpers.js:292): width/height fold into a resolution,
 * loras pair up with their weights, media params absorb their filename/resolution/duration facts,
 * and prep/generation times merge into one row.
 */

import { hasTranslation, t, tDynamic } from '@/i18n';
import { isMediaListType, isMediaType } from './media';
import type { NormalizedSchema } from './schema';

export interface MetadataEntry {
    id: string;
    label: string;
    /** The param's own description, used as the row tooltip. */
    description?: string;
    /** One line per value; list params (loras, image prompts) contribute several. */
    value: string[];
    /** Long free text - rendered as a full-width block with a copy button. */
    long?: boolean;
}

export interface MetadataSection {
    /** Translation identifier for the heading, resolved by the view that renders it. */
    titleKey: string;
    entries: MetadataEntry[];
}

export interface ParsedMetadata {
    sections: MetadataSection[];
    /** Pretty-printed source, for the raw toggle and for payloads we can't read. */
    raw: string;
    /** True when the payload isn't metadata we understand; only `raw` says anything then. */
    unreadable: boolean;
}

/** Labels for keys we synthesize ourselves, or that must still read well when the param schema
 *  hasn't loaded. Anything else takes the schema's name, then falls back to humanize().
 *
 *  Keys not listed here resolve through `metadata.label.<key>` when a translation exists, which is
 *  how an extension's own metadata key can be named without touching this list. */
function labelFor(key: string): string | undefined {
    const id = `metadata.label.${key}`;
    return hasTranslation(id) ? t(id) : undefined;
}

/** Params worth reading first, in this order. The rest keep the order the image recorded them in. */
const TOP_KEYS = ['model', 'loras', 'resolution', 'seed', 'steps', 'cfgscale', 'images'];

/** Prompt-ish keys, pulled out of the parameter list into their own section. */
const PROMPT_KEYS = ['prompt', 'negativeprompt'];

/** Strips the `//cid=N` markers Swarm adds to embedded prompt objects, so a prompt that only
 *  differs from `original_prompt` by those markers can be recognized as the same text. */
const CID_MARKER = /<(.*?)\/\/cid=\d+>/g;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Scalar, or a flat array of scalars. Nested structure beyond that isn't worth listing. */
function isSimple(value: unknown): boolean {
    return Array.isArray(value) ? value.every(item => !isRecord(item) && !Array.isArray(item)) : !isRecord(value);
}

function asList(value: unknown): unknown[] {
    if (value === null || value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

/** `cfg_scale` -> `Cfg scale`. Only reached for keys with no schema entry and no explicit label. */
function humanize(key: string): string {
    const text = key.replace(/_/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatScalar(value: unknown): string {
    if (typeof value === 'boolean') {
        return value ? t('common.yes') : t('common.no');
    }
    if (typeof value === 'number') {
        // Float params come back with trailing noise (7.000000001); nobody wants to read that.
        return String(Math.round(value * 1e6) / 1e6);
    }
    const text = String(value);
    // Inline media is megabytes of base64. The filename row beside it is the useful part.
    return text.startsWith('data:') ? t('metadata.inlineFileData') : text;
}

function formatValue(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter(item => !isEmpty(item)).flatMap(formatValue);
    }
    if (isRecord(value)) {
        return Object.entries(value)
            .filter(([, item]) => !isEmpty(item))
            .map(([key, item]) => `${humanize(key)}: ${formatValue(item).join(', ')}`);
    }
    return [formatScalar(value)];
}

function makeEntry(
    key: string,
    value: unknown,
    schema: NormalizedSchema | null,
    long = false
): MetadataEntry | null {
    if (isEmpty(value)) {
        return null;
    }
    const param = schema?.byId.get(key);
    let shown = value;
    // Dropdown params store the machine value; show what the picker would have said.
    if (param?.values && param.value_names && param.values.length === param.value_names.length) {
        const index = param.values.indexOf(String(value));
        if (index !== -1) {
            shown = param.value_names[index];
        }
    }
    return {
        id: key,
        // Schema names come from the server, so they translate by source text; our own synthesized
        // keys have identifiers instead.
        label: param?.name ? tDynamic(param.name) : (labelFor(key) ?? humanize(key)),
        description: param?.description ? tDynamic(param.description) : undefined,
        value: formatValue(shown),
        long: long || undefined
    };
}

function entriesFor(
    source: Record<string, unknown>,
    keys: string[],
    schema: NormalizedSchema | null
): MetadataEntry[] {
    return keys
        .map(key => makeEntry(key, source[key], schema))
        .filter((entry): entry is MetadataEntry => entry !== null);
}

/** Folds `<param>_filename` / `_resolution` / `_duration` back into the media param's own value,
 *  so an init image reads as `cat.png (512x512)` on one row instead of three. */
function combineMedia(
    params: Record<string, unknown>,
    extra: Record<string, unknown>,
    schema: NormalizedSchema | null
): void {
    for (const key of Object.keys(extra)) {
        if (!key.endsWith('_filename')) {
            continue;
        }
        const id = key.slice(0, -'_filename'.length);
        const param = schema?.byId.get(id);
        if (!param || !isMediaType(param.type)) {
            continue;
        }
        const names = asList(extra[key]);
        const resolutions = asList(extra[`${id}_resolution`]);
        const durations = asList(extra[`${id}_duration`]);
        const values = asList(params[id]);
        const list = isMediaListType(param.type);
        const count = list ? Math.max(names.length, values.length) : 1;
        const combined: string[] = [];
        for (let i = 0; i < count; i++) {
            const value = names[i] ?? values[i];
            if (isEmpty(value)) {
                continue;
            }
            let text = formatScalar(value);
            const duration = Number(durations[i]);
            if (durations[i] && !Number.isNaN(duration)) {
                text += ` (${Math.round(duration * 100) / 100}s)`;
            }
            if (resolutions[i]) {
                text += ` (${resolutions[i]})`;
            }
            combined.push(text);
        }
        if (combined.length > 0) {
            params[id] = list ? combined : combined[0];
        }
        delete extra[key];
        delete extra[`${id}_resolution`];
        delete extra[`${id}_duration`];
    }
}

/** width + height (+ aspect ratio) become one resolution row. */
function combineResolution(params: Record<string, unknown>): void {
    if (isEmpty(params.width) || isEmpty(params.height)) {
        return;
    }
    let text = `${params.width}x${params.height}`;
    if (!isEmpty(params.aspectratio)) {
        text += isEmpty(params.sidelength)
            ? ` (${params.aspectratio})`
            : ` (${params.aspectratio} @ ${params.sidelength})`;
    }
    delete params.width;
    delete params.height;
    delete params.aspectratio;
    delete params.sidelength;
    params.resolution = text;
}

/** Parallel `loras` / `loraweights` / `lorasectionconfinement` arrays become `name : weight` lines. */
function combineLoras(params: Record<string, unknown>): void {
    const loras = params.loras;
    const weights = params.loraweights;
    if (!Array.isArray(loras) || !Array.isArray(weights)) {
        return;
    }
    const confinement = params.lorasectionconfinement;
    const lines = loras.map((lora, index) => {
        let text = `${lora} : ${weights[index] ?? '?'}`;
        const section = Array.isArray(confinement) ? Number(confinement[index]) : 0;
        if (section > 0) {
            text += ` (${t('metadata.loraSection', { section })})`;
        }
        return text;
    });
    delete params.loraweights;
    delete params.lorasectionconfinement;
    params.loras = lines;
}

function combineTimings(extra: Record<string, unknown>): void {
    if (isEmpty(extra.prep_time) || isEmpty(extra.generation_time)) {
        return;
    }
    const value = t('metadata.timings', {
        prep: String(extra.prep_time),
        generation: String(extra.generation_time)
    });
    delete extra.prep_time;
    delete extra.generation_time;
    extra.generation_time = value;
}

/** The models section: name plus a shortened hash, one row per param that used a model. */
function modelEntries(models: unknown, schema: NormalizedSchema | null): MetadataEntry[] {
    if (!Array.isArray(models)) {
        return [];
    }
    const byParam = new Map<string, string[]>();
    for (const model of models) {
        if (!isRecord(model) || isEmpty(model.name)) {
            continue;
        }
        const param = String(model.param ?? 'model');
        const hash = typeof model.hash === 'string' && model.hash ? ` — ${model.hash.slice(0, 16)}…` : '';
        const lines = byParam.get(param);
        if (lines) {
            lines.push(`${model.name}${hash}`);
        }
        else {
            byParam.set(param, [`${model.name}${hash}`]);
        }
    }
    return [...byParam].map(([param, lines]) => {
        const name = schema?.byId.get(param)?.name;
        return {
            id: `model:${param}`,
            label: name ? tDynamic(name) : (labelFor(param) ?? humanize(param)),
            value: lines
        };
    });
}

export function parseImageMetadata(
    raw: string | null | undefined,
    schema: NormalizedSchema | null
): ParsedMetadata | null {
    if (!raw) {
        return null;
    }
    let data: unknown;
    try {
        data = JSON.parse(raw);
    }
    catch {
        // The API doesn't guarantee JSON here (older images, other tools' formats).
        return { sections: [], raw, unreadable: true };
    }
    if (!isRecord(data)) {
        return { sections: [], raw, unreadable: true };
    }
    const pretty = JSON.stringify(data, null, 2);
    // Non-Swarm images (Fooocus, A1111 upverts) arrive as a flat key/value object; those still list
    // fine. Anything deeply nested - a whole Comfy workflow, say - only reads as JSON.
    const swarm = isRecord(data.sui_image_params);
    if (!swarm && !Object.values(data).every(isSimple)) {
        return { sections: [], raw: pretty, unreadable: true };
    }
    const params: Record<string, unknown> = swarm ? { ...(data.sui_image_params as object) } : { ...data };
    const extra: Record<string, unknown> = isRecord(data.sui_extra_data) ? { ...data.sui_extra_data } : {};

    combineMedia(params, extra, schema);
    combineResolution(params);
    combineLoras(params);
    combineTimings(extra);
    // Version says nothing about the image itself; it belongs with the other bookkeeping.
    if (!isEmpty(params.swarm_version)) {
        extra.swarm_version = params.swarm_version;
        delete params.swarm_version;
    }
    // `original_prompt` is only interesting when it differs from what was actually generated with.
    if (
        typeof params.prompt === 'string' &&
        typeof extra.original_prompt === 'string' &&
        params.prompt.replace(CID_MARKER, '<$1>') === extra.original_prompt
    ) {
        params.prompt = extra.original_prompt;
        delete extra.original_prompt;
    }

    const prompts = [
        ...PROMPT_KEYS.map(key => makeEntry(key, params[key], schema, true)),
        makeEntry('original_prompt', extra.original_prompt, schema, true)
    ].filter((entry): entry is MetadataEntry => entry !== null);
    delete extra.original_prompt;

    const paramKeys = [
        ...TOP_KEYS.filter(key => key in params),
        ...Object.keys(params).filter(key => !TOP_KEYS.includes(key) && !PROMPT_KEYS.includes(key))
    ];

    const sections: MetadataSection[] = [
        { titleKey: 'metadata.section.prompt', entries: prompts },
        { titleKey: 'metadata.section.parameters', entries: entriesFor(params, paramKeys, schema) },
        { titleKey: 'metadata.section.models', entries: modelEntries(data.sui_models, schema) },
        { titleKey: 'metadata.section.details', entries: entriesFor(extra, Object.keys(extra), schema) }
    ].filter(section => section.entries.length > 0);

    return { sections, raw: pretty, unreadable: sections.length === 0 };
}
