/** The model catalog behind the Generate-page pickers.
 *
 * Two server sources are merged, because neither alone is sufficient:
 *   - `ListT2IParams.models` is authoritative for what a param will actually accept, and carries
 *     each model's architecture id, which is all the compatibility rules need.
 *   - `ListModels` carries the human-facing metadata - preview image, title, tags, trigger phrase,
 *     default LoRA weight - but is permission-gated and capped by ModelListSanityCap, so it is
 *     treated as enrichment only. A model it omits still appears, just without a thumbnail.
 *
 * The legacy UI keeps these two in separate worlds: the dropdown in `input_model` is built from the
 * param list and shows nothing but a name, while the metadata lives in a browser pane elsewhere.
 */

import { useMemo } from 'react';
import { usePermission } from '@/api/permissions';
import type { ModelCompatClassInfo } from '@/api/types';
import { cleanModelName, useParamSchema, type NormalizedSchema } from '@/params/schema';
import { useParamStore } from '@/params/store';
import { useModels, useMyUserData } from './hooks';
import { isModelCard, previewUrl, type ModelCard, type ModelSubtype } from './types';

/** ListModels clamps depth to 20 (src/WebAPI/ModelsAPI.cs:191); a picker wants the whole library,
 *  not the three levels the folder browser walks. */
const ALL_DEPTH = 20;

/** The subtype the main `model` param picks from. Everything else is an add-on to it. */
export const BASE_SUBTYPE = 'Stable-Diffusion';

/** One selectable model, as the pickers need it. */
export interface ModelOption {
    /** Name as the params spell it - no `.safetensors`. This is what gets stored in a param. */
    name: string;
    /** Name as the model routes spell it, or null when only the param list knows this model.
     *  Starring and metadata edits key off this, not the cleaned name. */
    rawName: string | null;
    /** Folder path the model sits in, '' at the root. */
    folder: string;
    /** File name without its folders. */
    leaf: string;
    /** Metadata title where there is one, otherwise the leaf name. */
    title: string;
    description: string | null;
    preview: string | undefined;
    /** Architecture id, eg 'stable-diffusion-xl-v1-base/lora'. */
    architecture: string | null;
    /** Display name of that architecture, eg 'Stable Diffusion XL 1.0-Base LoRA'. */
    className: string | null;
    /** Interoperability family id, shared with every model this one can be used alongside. */
    compatClass: string | null;
    /** Badge label for that family, eg 'SDXL'. */
    shortCode: string | null;
    tags: string[];
    triggerPhrase: string | null;
    /** True when a backend currently has it in memory. */
    loaded: boolean;
    starred: boolean;
    /** Weight the model's own metadata asks for, or null to fall back to 1. */
    defaultWeight: number | null;
    /** File mtime, for the "Newest" sort. 0 when unknown. */
    modified: number;
}

/** Compat family of an architecture id, or null if the server could not classify it. */
export function compatClassOf(schema: NormalizedSchema | null, architecture: string | null): string | null {
    if (!schema || !architecture) {
        return null;
    }
    return schema.modelClasses[architecture]?.compat_class ?? null;
}

/** Full compat family record, for the badge label and the video/audio flags. */
export function compatInfoOf(
    schema: NormalizedSchema | null,
    compatClass: string | null
): ModelCompatClassInfo | null {
    if (!schema || !compatClass) {
        return null;
    }
    return schema.compatClasses[compatClass] ?? null;
}

/** Whether `option` can be used on top of a base model whose compat class is `current`.
 *
 * Ported from isModelArchCorrect (src/wwwroot/js/genpage/gentab/models.js:435), including its three
 * hand-listed cross-family exceptions. Unknowns answer "yes": an unclassified file may well work,
 * and hiding it would leave the user with no way to reach it.
 *
 * Base models (architectures with no `/suffix`) are always allowed - they are the thing being
 * matched against, not a match for it. */
export function isArchCompatible(option: ModelOption, current: string | null): boolean {
    const arch = option.architecture;
    if (!arch || !option.compatClass || !current || !arch.includes('/')) {
        return true;
    }
    // VAEs and a few LoRA families interoperate across compat classes.
    if (arch.endsWith('/vae') && option.compatClass.startsWith('stable-diffusion-v3') && current.startsWith('stable-diffusion-v3')) {
        return true;
    }
    if (arch.endsWith('/vae') && option.compatClass.startsWith('flux-1') && current.startsWith('hidream-i1')) {
        return true;
    }
    if (arch.endsWith('/lora') && option.compatClass.startsWith('flux-1') && current.startsWith('chroma')) {
        return true;
    }
    return option.compatClass === current;
}

/** Plural, lower-case-where-natural name for a model subtype, for search placeholders and empty
 *  states. Falls back to the subtype id, which is already readable for anything unlisted. */
export function subtypeNoun(subtype: string): string {
    return SUBTYPE_NOUNS[subtype] ?? `${subtype} models`;
}

const SUBTYPE_NOUNS: Record<string, string> = {
    'Stable-Diffusion': 'models',
    LoRA: 'LoRAs',
    VAE: 'VAEs',
    Embedding: 'embeddings',
    ControlNet: 'ControlNets',
    Clip: 'CLIP models',
    ClipVision: 'CLIP-Vision models'
};

/** True when models of this subtype are add-ons whose compat class has to match the base model.
 *  The base models themselves are what everything else is compared against. */
export function subtypeUsesCompat(subtype: string): boolean {
    return subtype !== BASE_SUBTYPE;
}

function parseWeight(raw: string | undefined | null): number | null {
    if (!raw) {
        return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/** Builds one option from the param list, folding in the ListModels card when there is one. */
function buildOption(
    name: string,
    architecture: string | null,
    card: ModelCard | undefined,
    schema: NormalizedSchema,
    starred: Set<string>
): ModelOption {
    // The param list's architecture is what the server will itself use; the card only fills the gap
    // for models the param list could not classify.
    const arch = architecture ?? card?.architecture ?? null;
    const compatClass = compatClassOf(schema, arch) ?? card?.compat_class ?? null;
    const slash = name.lastIndexOf('/');
    return {
        name,
        rawName: card?.name ?? null,
        folder: slash === -1 ? '' : name.slice(0, slash),
        leaf: slash === -1 ? name : name.slice(slash + 1),
        title: card?.title || (slash === -1 ? name : name.slice(slash + 1)),
        description: card?.description ?? null,
        preview: previewUrl(card?.preview_image),
        architecture: arch,
        className: schema.modelClasses[arch ?? '']?.name ?? card?.class ?? null,
        compatClass,
        shortCode: compatInfoOf(schema, compatClass)?.short_code ?? null,
        tags: card?.tags ?? [],
        triggerPhrase: card?.trigger_phrase ?? null,
        loaded: card?.loaded ?? false,
        starred: card ? starred.has(card.name) : starred.has(name),
        defaultWeight: parseWeight(card?.lora_default_weight),
        modified: card?.time_modified ?? 0
    };
}

export interface ModelCatalog {
    options: ModelOption[];
    byName: Map<string, ModelOption>;
    /** True once ListModels has answered, ie thumbnails and metadata are in. */
    detailed: boolean;
    /** True while the metadata request is still out; the names are already usable. */
    loadingDetails: boolean;
}

/** Every model of one subtype, name-ordered with starred entries first.
 *
 * `enabled` gates only the metadata request - the names come from the schema that is loaded
 * anyway, so a picker that has never been opened costs nothing extra. */
export function useModelCatalog(subtype: string, enabled = true): ModelCatalog {
    const schema = useParamSchema();
    const canListModels = usePermission('fundamental_model_access');
    const cards = useModels(
        subtype as ModelSubtype,
        '',
        'Name',
        false,
        ALL_DEPTH,
        enabled && canListModels && Boolean(schema)
    );
    const userData = useMyUserData(enabled);
    const starredList = userData.data?.starred_models?.[subtype];
    const files = cards.data?.files;

    return useMemo(() => {
        const names = schema?.models[subtype] ?? [];
        const arch = schema?.modelArch[subtype] ?? {};
        const starred = new Set(starredList ?? []);
        const cardsByName = new Map<string, ModelCard>();
        for (const file of files ?? []) {
            if (isModelCard(file)) {
                cardsByName.set(cleanModelName(file.name), file);
            }
        }
        const options = schema
            ? names.map(name => buildOption(name, arch[name] ?? null, cardsByName.get(name), schema, starred))
            : [];
        options.sort(
            (a, b) => Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name)
        );
        return {
            options,
            byName: new Map(options.map(option => [option.name, option])),
            detailed: cardsByName.size > 0,
            loadingDetails: cards.isFetching
        };
    }, [schema, subtype, files, starredList, cards.isFetching]);
}

/** What the currently selected base model is, for compatibility filtering and badges.
 *  Reads the param store rather than a card list, so it needs no request of its own. */
export function useCurrentModel(): {
    name: string;
    architecture: string | null;
    compatClass: string | null;
    /** Badge label for the family, eg 'SDXL'. Falls back to the raw id where there is no code. */
    label: string | null;
} {
    const schema = useParamSchema();
    const name = String(useParamStore(s => s.values.model) ?? '');
    return useMemo(() => {
        const architecture = schema?.modelArch[BASE_SUBTYPE]?.[name] ?? null;
        const compatClass = compatClassOf(schema, architecture);
        const info = compatInfoOf(schema, compatClass);
        return {
            name,
            architecture,
            compatClass,
            label: info?.short_code || compatClass
        };
    }, [schema, name]);
}
