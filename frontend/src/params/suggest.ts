/** Suggested sampling settings for the selected base model.
 *
 * Several sources are layered, each later one overriding the earlier where it has an opinion:
 *   1. The architecture family, from what docs/Model Support.md recommends for it. This decides
 *      most of it: a Flux model wants CFG 1 whatever finetune it is.
 *   2. Variant markers in the file name or title: a "turbo", "lightning" or "base" file of a family
 *      wants very different steps and CFG than the family's usual one.
 *   3. The base model the downloader recorded as the usage hint (Pony, Illustrious).
 *   4. The Civitai example images of the exact version, when the model was downloaded from Civitai.
 *      Those images carry the author's own generation settings, so they beat any general rule.
 *
 * A suggestion of `null` means "leave it to the model": the toggle goes off, which is what lets the
 * server pick its own per-model default (eg the Beta scheduler for Chroma). That matters most for
 * the sampler, since a leftover SDE or ancestral sampler from an SDXL session breaks a
 * rectified-flow model.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import type { ParamSchema } from '@/api/types';
import { civitaiGet, parseCivitaiUrl } from '@/tools/modelSource';
import type { NormalizedSchema } from './schema';
import { applyPresetMap, toStoredString } from './presets';
import { coerceValue, useParamStore, valueOf, type ParamValue } from './store';

/** Where a suggested value came from, for the label beside it. */
export type SuggestionSource =
    | { kind: 'family' }
    | { kind: 'variant'; marker: string }
    | { kind: 'hint'; hint: string }
    | { kind: 'civitai'; count: number };

/** A suggested value: a concrete one, or null for "model default". */
type SuggestedValue = string | number | null;
type ValueSet = Record<string, SuggestedValue>;

/** One parameter the panel should change to match the suggestion. */
export interface Suggestion {
    param: ParamSchema;
    value: SuggestedValue;
    source: SuggestionSource;
}

/** What the rules are matched against: the model's architecture, its family, and its name and
 *  title lowercased together, so a marker in either counts. */
interface ModelContext {
    architecture: string;
    compatClass: string;
    text: string;
}

/** Parameters the suggestions touch, in the order they are listed. */
const PARAM_ORDER = ['steps', 'cfgscale', 'fluxguidancescale', 'sampler', 'scheduler', 'clipstopatlayer'];

/** Leaves sampler and scheduler to the model. Rectified-flow families all want this. */
const MODEL_SAMPLING: ValueSet = { sampler: null, scheduler: null };

function hasWord(text: string, word: string): boolean {
    return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(text);
}

/** A step count spelled out in the name, as distilled releases do ("lightning_4step"). */
function namedSteps(text: string): number | null {
    const match = /(\d{1,2})[-_ ]?steps?(?![a-z])/.exec(text);
    const steps = match ? Number(match[1]) : 0;
    return steps >= 1 && steps <= 12 ? steps : null;
}

/** A name marker that switches a family to a different variant's settings. */
interface Variant {
    marker: string;
    test: (text: string) => boolean;
    values: (text: string) => ValueSet;
}

/** One architecture family. `compat`/`arch` are prefixes matched against the model's compat class
 *  and architecture id. The first family that matches wins, so narrower ones come first. */
interface Family {
    compat?: string[];
    arch?: string[];
    values: ValueSet;
    variants?: Variant[];
}

/** Distillation variants shared by the UNet families (SD1, SD2, SDXL), whose finetunes come in
 *  every flavour. */
const UNET_VARIANTS: Variant[] = [
    {
        marker: 'lcm',
        test: text => hasWord(text, 'lcm'),
        values: text => ({ steps: namedSteps(text) ?? 4, cfgscale: 1, sampler: 'lcm', scheduler: null })
    },
    {
        marker: 'dmd2',
        test: text => text.includes('dmd2'),
        values: text => ({ steps: namedSteps(text) ?? 8, cfgscale: 1, sampler: 'lcm', scheduler: null })
    },
    {
        marker: 'lightning',
        test: text => text.includes('lightning'),
        values: text => ({ steps: namedSteps(text) ?? 8, cfgscale: 1, sampler: 'euler', scheduler: 'sgm_uniform' })
    },
    {
        marker: 'hyper',
        // Bare "hyper" would catch every "HyperRealistic" finetune.
        test: text => /hyper[-_ ]?(sd|sdxl|\d{1,2}[-_ ]?steps?)(?![a-z])/.test(text),
        values: text => ({ steps: namedSteps(text) ?? 8, cfgscale: 1, sampler: 'euler', scheduler: 'sgm_uniform' })
    },
    {
        marker: 'turbo',
        test: text => text.includes('turbo'),
        values: text => ({ steps: namedSteps(text) ?? 8, cfgscale: 2, sampler: 'dpmpp_sde', scheduler: 'karras' })
    }
];

/** Splits a family into its turbo and base variants by name. A file that names neither gets only
 *  the family's shared values, since guessing wrong here means either burnt or blurry images. */
function turboOrBase(turbo: ValueSet, base: ValueSet, baseMarker = 'base'): Variant[] {
    return [
        { marker: 'turbo', test: text => text.includes('turbo'), values: () => turbo },
        { marker: baseMarker, test: text => hasWord(text, baseMarker), values: () => base }
    ];
}

/** Values from docs/Model Support.md, family by family. Families it gives no settings for are
 *  left out: those still get the Civitai layer. */
const FAMILIES: Family[] = [
    // The official turbo releases have architectures of their own.
    { arch: ['stable-diffusion-xl-turbo-v1'], values: { steps: 1, cfgscale: 1, sampler: null, scheduler: 'turbo' } },
    { compat: ['stable-diffusion-v2-turbo'], values: { steps: 1, cfgscale: 1, sampler: null, scheduler: 'turbo' } },
    {
        compat: ['stable-diffusion-xl-v1', 'segmind-stable-diffusion-1b'],
        values: { steps: 25, cfgscale: 6, sampler: 'dpmpp_2m', scheduler: 'karras' },
        variants: UNET_VARIANTS
    },
    {
        compat: ['stable-diffusion-v1', 'stable-diffusion-v2'],
        values: { steps: 25, cfgscale: 7, sampler: 'dpmpp_2m', scheduler: 'karras' },
        variants: UNET_VARIANTS
    },
    {
        compat: ['stable-diffusion-v3.5-large'],
        values: { steps: 28, cfgscale: 3.5, ...MODEL_SAMPLING },
        variants: [
            { marker: 'turbox', test: text => text.includes('turbox'), values: () => ({ steps: 8, cfgscale: 1 }) },
            { marker: 'turbo', test: text => text.includes('turbo'), values: () => ({ steps: 4, cfgscale: 1 }) }
        ]
    },
    { compat: ['stable-diffusion-v3.5-medium'], values: { steps: 40, cfgscale: 4.5, ...MODEL_SAMPLING } },
    { compat: ['stable-diffusion-v3'], values: { steps: 28, cfgscale: 7, ...MODEL_SAMPLING } },
    { arch: ['Flux.1-schnell'], values: { steps: 4, cfgscale: 1, ...MODEL_SAMPLING } },
    { arch: ['Flux.1-dev'], values: { steps: 20, cfgscale: 1, fluxguidancescale: null, ...MODEL_SAMPLING } },
    { compat: ['flux-1'], values: { cfgscale: 1, ...MODEL_SAMPLING } },
    {
        compat: ['flux-2-klein'],
        values: { steps: 8, cfgscale: 1, ...MODEL_SAMPLING },
        variants: [{ marker: 'base', test: text => hasWord(text, 'base'), values: () => ({ steps: 30, cfgscale: 7 }) }]
    },
    {
        compat: ['flux-2'],
        values: { steps: 20, cfgscale: 1, fluxguidancescale: null, ...MODEL_SAMPLING },
        variants: [
            { marker: 'turbo', test: text => text.includes('turbo'), values: () => ({ steps: 8, scheduler: 'align_your_steps' }) }
        ]
    },
    { compat: ['chroma-radiance'], values: { steps: 30, cfgscale: 3.5, ...MODEL_SAMPLING } },
    { compat: ['chroma'], values: { steps: 26, cfgscale: 3.5, ...MODEL_SAMPLING } },
    { compat: ['lumina-2'], values: { steps: 20, cfgscale: 4, ...MODEL_SAMPLING } },
    { arch: ['qwen-image-edit'], values: { steps: 20, cfgscale: 1, ...MODEL_SAMPLING } },
    {
        compat: ['qwen-image'],
        values: { steps: 20, cfgscale: 4, ...MODEL_SAMPLING },
        variants: [
            {
                marker: 'lightning',
                test: text => text.includes('lightning'),
                values: text => ({ steps: namedSteps(text) ?? 8, cfgscale: 1 })
            }
        ]
    },
    { arch: ['hunyuan-image-2_1-refiner'], values: { steps: 4, cfgscale: 1, ...MODEL_SAMPLING } },
    { compat: ['hunyuan-image-2_1'], values: { steps: 20, cfgscale: 3.5, ...MODEL_SAMPLING } },
    {
        compat: ['z-image'],
        values: MODEL_SAMPLING,
        variants: turboOrBase({ steps: 8, cfgscale: 1 }, { steps: 20, cfgscale: 4 })
    },
    { compat: ['kandinsky5-imglite'], values: { steps: 20, cfgscale: 5 } },
    { compat: ['anima'], values: { steps: 20, cfgscale: 4, ...MODEL_SAMPLING } },
    {
        compat: ['hidream-o1'],
        values: MODEL_SAMPLING,
        variants: [
            { marker: 'dev', test: text => hasWord(text, 'dev'), values: () => ({ steps: 28, cfgscale: 1 }) },
            { marker: 'base', test: text => hasWord(text, 'base'), values: () => ({ steps: 50, cfgscale: 5 }) }
        ]
    },
    { compat: ['ideogram-4'], values: { cfgscale: 7 } },
    {
        compat: ['krea-2'],
        values: MODEL_SAMPLING,
        variants: turboOrBase({ steps: 8, cfgscale: 1 }, { steps: 20 }, 'raw')
    },
    {
        compat: ['boogu'],
        values: { steps: 20, cfgscale: 4, sampler: 'dpmpp_2m', scheduler: null },
        variants: [
            {
                marker: 'turbo',
                test: text => text.includes('turbo'),
                values: () => ({ steps: 4, cfgscale: 1, sampler: 'lcm', scheduler: 'sgm_uniform' })
            }
        ]
    }
];

/** Base models the downloader records as the usage hint, and what their finetunes expect. Both
 *  are trained with the last CLIP layer skipped, which their model pages ask for as "clip skip 2". */
const HINTS: Record<string, ValueSet> = {
    pony: { clipstopatlayer: -2 },
    illustrious: { clipstopatlayer: -2 }
};

/** Families whose finetunes take a clip skip. */
const CLIP_SKIP_FAMILIES = ['stable-diffusion-v1', 'stable-diffusion-v2', 'stable-diffusion-xl-v1'];

function startsWithAny(value: string, prefixes: string[] | undefined): boolean {
    return (prefixes ?? []).some(prefix => value.startsWith(prefix));
}

/** Every value from the rule layers, with where each one came from. */
function ruleSuggestions(ctx: ModelContext, usageHint: string | null): Map<string, [SuggestedValue, SuggestionSource]> {
    const out = new Map<string, [SuggestedValue, SuggestionSource]>();
    const put = (values: ValueSet, source: SuggestionSource) => {
        for (const [id, value] of Object.entries(values)) {
            out.set(id, [value, source]);
        }
    };
    const family = FAMILIES.find(
        entry => startsWithAny(ctx.compatClass, entry.compat) || startsWithAny(ctx.architecture, entry.arch)
    );
    if (family) {
        put(family.values, { kind: 'family' });
        const variant = family.variants?.find(entry => entry.test(ctx.text));
        if (variant) {
            put(variant.values(ctx.text), { kind: 'variant', marker: variant.marker });
        }
    }
    const hint = usageHint?.trim() ?? '';
    if (HINTS[hint.toLowerCase()]) {
        put(HINTS[hint.toLowerCase()], { kind: 'hint', hint });
    }
    return out;
}

/** The generation settings Civitai keeps on an example image. A1111 uploads and Comfy uploads
 *  spell them differently, so both spellings are read. */
interface CivitaiImageMeta {
    sampler?: string;
    scheduler?: string;
    'Schedule type'?: string;
    steps?: number | string;
    cfgScale?: number | string;
    clipSkip?: number | string;
    'Clip skip'?: number | string;
}

interface CivitaiVersionImages {
    images?: { meta?: CivitaiImageMeta | null }[];
}

/** A1111 sampler names, lowercased, to the Comfy ids the Sampler param takes. Comfy uploads already
 *  carry the ids themselves, which pass through as they are. */
const A1111_SAMPLERS: Record<string, string> = {
    'euler': 'euler',
    'euler a': 'euler_ancestral',
    'heun': 'heun',
    'dpm2': 'dpm_2',
    'dpm2 a': 'dpm_2_ancestral',
    'lms': 'lms',
    'dpm fast': 'dpm_fast',
    'dpm adaptive': 'dpm_adaptive',
    'dpm++ 2s a': 'dpmpp_2s_ancestral',
    'dpm++ sde': 'dpmpp_sde',
    'dpm++ 2m': 'dpmpp_2m',
    'dpm++ 2m sde': 'dpmpp_2m_sde',
    'dpm++ 2m sde heun': 'dpmpp_2m_sde_heun',
    'dpm++ 3m sde': 'dpmpp_3m_sde',
    'ddim': 'ddim',
    'ddpm': 'ddpm',
    'lcm': 'lcm',
    'unipc': 'uni_pc',
    'ipndm': 'ipndm',
    'deis': 'deis'
};

/** A1111 schedule types, lowercased, to Comfy scheduler ids. "Automatic" is left out on purpose:
 *  it means "whatever the sampler likes", which says nothing. */
const A1111_SCHEDULERS: Record<string, string> = {
    'karras': 'karras',
    'exponential': 'exponential',
    'sgm uniform': 'sgm_uniform',
    'simple': 'simple',
    'normal': 'normal',
    'beta': 'beta',
    'align your steps': 'align_your_steps',
    'ddim': 'ddim_uniform',
    'kl optimal': 'kl_optimal'
};

function toId(raw: string, table: Record<string, string>): string {
    const lowered = raw.trim().toLowerCase();
    return table[lowered] ?? lowered.replace(/\s+/g, '_');
}

/** Splits an old-style A1111 sampler name ("DPM++ 2M Karras") into sampler and scheduler. */
function parseSampler(raw: string): [string, string | null] {
    for (const suffix of [' karras', ' exponential']) {
        if (raw.toLowerCase().endsWith(suffix)) {
            return [toId(raw.slice(0, -suffix.length), A1111_SAMPLERS), suffix.trim()];
        }
    }
    return [toId(raw, A1111_SAMPLERS), null];
}

function finite(raw: number | string | undefined): number | null {
    const value = typeof raw === 'number' ? raw : Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(value) ? value : null;
}

function mode<T>(values: T[]): T | null {
    const counts = new Map<T, number>();
    let best: T | null = null;
    let bestCount = 0;
    for (const value of values) {
        const count = (counts.get(value) ?? 0) + 1;
        counts.set(value, count);
        if (count > bestCount) {
            best = value;
            bestCount = count;
        }
    }
    return best;
}

function median(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/** Settings agreed on across a version's example images, and how many images had any. */
export function civitaiConsensus(data: CivitaiVersionImages | null): { values: ValueSet; count: number } {
    const samplers: string[] = [];
    const schedulers: string[] = [];
    const steps: number[] = [];
    const cfgs: number[] = [];
    const clipSkips: number[] = [];
    let count = 0;
    for (const image of data?.images ?? []) {
        const meta = image.meta;
        if (!meta || (finite(meta.steps) === null && !meta.sampler)) {
            continue;
        }
        count++;
        let scheduler = meta['Schedule type'] ?? meta.scheduler ?? null;
        if (meta.sampler) {
            const [sampler, fromName] = parseSampler(meta.sampler);
            samplers.push(sampler);
            scheduler ??= fromName;
        }
        if (scheduler && scheduler.toLowerCase() !== 'automatic') {
            schedulers.push(toId(scheduler, A1111_SCHEDULERS));
        }
        const step = finite(meta.steps);
        if (step !== null && step > 0) {
            steps.push(Math.round(step));
        }
        const cfg = finite(meta.cfgScale);
        if (cfg !== null && cfg > 0) {
            cfgs.push(cfg);
        }
        const clip = finite(meta.clipSkip ?? meta['Clip skip']);
        if (clip !== null && clip >= 1) {
            clipSkips.push(Math.round(clip));
        }
    }
    const values: ValueSet = {};
    const sampler = mode(samplers);
    const scheduler = mode(schedulers);
    const step = median(steps);
    const cfg = median(cfgs);
    const clip = mode(clipSkips);
    if (sampler) {
        values.sampler = sampler;
    }
    if (scheduler) {
        values.scheduler = scheduler;
    }
    if (step !== null) {
        values.steps = step;
    }
    if (cfg !== null) {
        values.cfgscale = Math.round(cfg * 2) / 2;
    }
    if (clip !== null) {
        // Clip skip 1 is no skip at all, which is the model's own default.
        values.clipstopatlayer = clip === 1 ? null : -clip;
    }
    return { values, count };
}

/** The Civitai version a model was downloaded from. The downloader opens the description with a
 *  link to the version's page (modelSource.ts), and that link is the only record of it. */
export function civitaiVersionOf(description: string | null): string | null {
    const link = /https:\/\/civitai\.(?:red|com|green)\/[^\s"'<>]+/.exec(description ?? '');
    return link ? parseCivitaiUrl(link[0].replace(/&amp;/g, '&'))[1] : null;
}

/** The example images of one Civitai version. Asked once per version a session, since what an
 *  author published does not change while the page is open. */
export function useCivitaiExamples(versionId: string | null) {
    return useQuery({
        queryKey: ['civitai-version-examples', versionId],
        queryFn: () => civitaiGet<CivitaiVersionImages>(`api/v1/model-versions/${versionId}`),
        enabled: versionId !== null,
        staleTime: Infinity,
        retry: false
    });
}

/** Whether a dropdown param can take the value at all. The sampler and scheduler lists depend on
 *  the installed backend and its custom nodes, so a value may simply not be on offer here. */
function acceptable(param: ParamSchema, value: SuggestedValue): boolean {
    if (value === null || !param.values) {
        return true;
    }
    return param.values.includes(String(value));
}

/** Whether the panel already has the suggested value, so the row has nothing to offer. */
function matches(
    param: ParamSchema,
    value: SuggestedValue,
    values: Record<string, ParamValue>,
    toggles: Record<string, boolean>
): boolean {
    if (param.toggleable && toggles[param.id] !== true) {
        return value === null;
    }
    const current = toStoredString(valueOf(param, values));
    if (value === null) {
        return param.toggleable ? false : current === toStoredString(coerceValue(param, param.default));
    }
    return current === toStoredString(coerceValue(param, String(value)));
}

export interface SuggestedSettings {
    /** Rows that differ from what the panel has now, in display order. */
    changes: Suggestion[];
    /** True while the Civitai examples are still being fetched. */
    loadingCivitai: boolean;
    /** True when the model has a Civitai source at all. */
    hasCivitai: boolean;
}

/** Just the values and toggles of the params a suggestion can touch. Picked with a shallow compare,
 *  so the rest of the panel changing - a prompt being typed - does not re-render a subscriber. */
export function useSuggestionState(): { values: Record<string, ParamValue>; toggles: Record<string, boolean> } {
    const values = useParamStore(useShallow(s => pick(s.values, PARAM_ORDER)));
    const toggles = useParamStore(useShallow(s => pick(s.toggles, PARAM_ORDER)));
    return { values, toggles };
}

function pick<T>(record: Record<string, T>, ids: string[]): Record<string, T> {
    const out: Record<string, T> = {};
    for (const id of ids) {
        if (id in record) {
            out[id] = record[id];
        }
    }
    return out;
}

/** The suggestions for a model that differ from the current panel. */
export function useSuggestedSettings(
    schema: NormalizedSchema | null,
    model: {
        name: string;
        title: string | null;
        architecture: string | null;
        compatClass: string | null;
        description: string | null;
        usageHint: string | null;
    }
): SuggestedSettings {
    const { values, toggles } = useSuggestionState();
    const versionId = civitaiVersionOf(model.description);
    const civitai = useCivitaiExamples(versionId);

    const merged = useMemo(() => {
        const out = ruleSuggestions(
            {
                architecture: model.architecture ?? '',
                compatClass: model.compatClass ?? '',
                text: `${model.name} ${model.title ?? ''}`.toLowerCase()
            },
            model.usageHint
        );
        const consensus = civitaiConsensus(civitai.data ?? null);
        for (const [id, value] of Object.entries(consensus.values)) {
            // Uploads from A1111-style tools record a clip skip whatever the model, but only the
            // UNet families have a CLIP stack where it means anything.
            if (id === 'clipstopatlayer' && !startsWithAny(model.compatClass ?? '', CLIP_SKIP_FAMILIES)) {
                continue;
            }
            out.set(id, [value, { kind: 'civitai', count: consensus.count }]);
        }
        return out;
    }, [model.name, model.title, model.architecture, model.compatClass, model.usageHint, civitai.data]);

    const changes = useMemo(() => {
        const out: Suggestion[] = [];
        if (!schema) {
            return out;
        }
        for (const id of PARAM_ORDER) {
            const entry = merged.get(id);
            const param = schema.byId.get(id);
            if (!entry || !param || !acceptable(param, entry[0]) || matches(param, entry[0], values, toggles)) {
                continue;
            }
            out.push({ param, value: entry[0], source: entry[1] });
        }
        return out;
    }, [schema, merged, values, toggles]);

    return { changes, loadingCivitai: civitai.isFetching, hasCivitai: versionId !== null };
}

/** Puts suggestions into the panel. Concrete values go through the preset path, which also
 *  switches on the toggles and groups they need; "model default" switches the param back off. */
export function applySuggestions(changes: Suggestion[], schema: NormalizedSchema | null): void {
    const store = useParamStore.getState();
    const map: Record<string, string> = {};
    for (const change of changes) {
        if (change.value === null) {
            store.reset(change.param.id);
        }
        else {
            map[change.param.id] = String(change.value);
        }
    }
    applyPresetMap(map, schema);
}
