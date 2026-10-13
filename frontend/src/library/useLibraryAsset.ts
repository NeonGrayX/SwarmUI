/** Using a Library entry on the Generate form: what clicking one does in the legacy model browsers
 *  (ModelBrowserWrapper's selectOne callbacks, src/wwwroot/js/genpage/gentab/models.js).
 *
 * A base model becomes the model, a VAE or ControlNet fills its parameter, a LoRA joins the LoRA
 * list, and an embedding or wildcard goes into the prompt as its tag. The LoRA, embedding and
 * wildcard cases toggle, as legacy's do: using one that is already there takes it back out.
 */

import { useCallback, useMemo } from 'react';
import { useLoraSelection } from '@/params/loras';
import { applyPresetMap } from '@/params/presets';
import { cleanModelName, useParamSchema } from '@/params/schema';
import { useParamStore } from '@/params/store';
import { t } from '@/i18n';
import { useMyUserData } from './hooks';
import { isModelCard, type ModelCard, type ModelSubtype, type WildcardCard } from './types';

type Entry = ModelCard | WildcardCard;

/** The parameter a subtype's entry is written to, for the subtypes that simply fill one. */
const PARAM_FOR: Partial<Record<ModelSubtype, string>> = {
    'Stable-Diffusion': 'model',
    VAE: 'vae',
    ControlNet: 'controlnetmodel'
};

/** Status line for a filled parameter, by parameter id. */
const USED_KEY: Record<string, string> = {
    model: 'library.used.model',
    vae: 'library.used.vae',
    controlnetmodel: 'library.used.controlnet'
};

/** Flips `token` at the end of a prompt: appended when it is not the last thing there, removed when
 *  it is. Mirrors selectEmbedding (models.js) and selectWildcard (wildcards.js). */
function togglePromptToken(text: string, token: string): { text: string; added: boolean } {
    const trimmed = text.trimEnd();
    if (trimmed.endsWith(token)) {
        return { text: trimmed.slice(0, trimmed.length - token.length).trimEnd(), added: false };
    }
    return { text: trimmed ? `${trimmed} ${token}` : token, added: true };
}

/** The prompt tag for an embedding or a wildcard. */
function promptToken(subtype: ModelSubtype, entry: Entry): string | null {
    if (subtype === 'Embedding') {
        return `<embed:${cleanModelName(entry.name)}>`;
    }
    if (subtype === 'Wildcards') {
        return `<wildcard:${entry.name}>`;
    }
    return null;
}

/** Which prompt an entry's tag goes in: negative embeddings go to the negative prompt. */
function promptParam(entry: Entry): string {
    return isModelCard(entry) && entry.is_negative_embedding ? 'negativeprompt' : 'prompt';
}

function parseWeight(raw: string | null | undefined): number | null {
    if (!raw) {
        return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

export interface LibraryAssetUse {
    /** What using the entry would do, as an action label - or null when this subtype has no use on
     *  the Generate form, or this server has no parameter to put it in. */
    label: (entry: Entry) => string | null;
    /** Uses the entry, and returns what happened, for the status line. */
    use: (entry: Entry) => string;
    /** Whether the entry is what the form is currently using. */
    inUse: (entry: Entry) => boolean;
}

export function useLibraryAsset(subtype: ModelSubtype): LibraryAssetUse {
    const schema = useParamSchema();
    const loras = useLoraSelection();
    const userData = useMyUserData();
    const values = useParamStore(s => s.values);
    const toggles = useParamStore(s => s.toggles);

    const param = PARAM_FOR[subtype];
    const available = useMemo(() => {
        if (!schema) {
            return false;
        }
        if (param) {
            return schema.byId.has(param);
        }
        if (subtype === 'LoRA') {
            return schema.byId.has('loras');
        }
        if (subtype === 'Embedding' || subtype === 'Wildcards') {
            return schema.byId.has('prompt');
        }
        return false;
    }, [schema, param, subtype]);

    const inUse = useCallback(
        (entry: Entry): boolean => {
            const name = cleanModelName(entry.name);
            if (param) {
                const schemaParam = schema?.byId.get(param);
                const on = !schemaParam?.toggleable || toggles[param] === true;
                // Untouched, the form is on the schema default - which for `model` is usually set.
                const current = param in values ? values[param] : schemaParam?.default;
                return on && String(current ?? '') === name;
            }
            if (subtype === 'LoRA') {
                return loras.names.includes(name);
            }
            const token = promptToken(subtype, entry);
            return token !== null && String(values[promptParam(entry)] ?? '').includes(token);
        },
        [param, schema, toggles, values, subtype, loras.names]
    );

    const label = useCallback(
        (entry: Entry): string | null => {
            if (!available) {
                return null;
            }
            const using = inUse(entry);
            switch (subtype) {
                case 'Stable-Diffusion':
                    return t('library.use.model');
                case 'VAE':
                    return t('library.use.vae');
                case 'ControlNet':
                    return t('library.use.controlnet');
                case 'LoRA':
                    return using ? t('library.use.removeLora') : t('library.use.addLora');
                case 'Embedding':
                case 'Wildcards':
                    return t('library.use.insertPrompt');
                default:
                    return null;
            }
        },
        [available, inUse, subtype]
    );

    /** Applies the presets a model or LoRA is linked to, as legacy does when one is picked
     *  (ModelPresetLinkManager.addPresetsFrom). Returns how many were applied. */
    const applyLinkedPresets = useCallback(
        (name: string): number => {
            const titles = userData.data?.model_preset_links?.[subtype]?.[name] ?? [];
            let applied = 0;
            for (const title of titles) {
                const preset = userData.data?.presets.find(p => p.title === title);
                if (preset) {
                    applyPresetMap(preset.param_map, schema);
                    applied++;
                }
            }
            return applied;
        },
        [userData.data, subtype, schema]
    );

    const use = useCallback(
        (entry: Entry): string => {
            const name = cleanModelName(entry.name);
            if (param) {
                applyPresetMap({ [param]: name }, schema);
                const linked = applyLinkedPresets(name);
                const done = t(USED_KEY[param] ?? 'library.used.model', { name });
                return linked > 0 ? `${done} ${t('library.used.presets', { count: linked })}` : done;
            }
            if (subtype === 'LoRA') {
                const removing = loras.names.includes(name);
                loras.toggle(name, isModelCard(entry) ? parseWeight(entry.lora_default_weight) : null);
                if (removing) {
                    return t('library.used.loraRemoved', { name });
                }
                const linked = applyLinkedPresets(name);
                const done = t('library.used.loraAdded', { name });
                return linked > 0 ? `${done} ${t('library.used.presets', { count: linked })}` : done;
            }
            const token = promptToken(subtype, entry);
            if (token === null) {
                return '';
            }
            const target = promptParam(entry);
            const store = useParamStore.getState();
            const next = togglePromptToken(String(store.values[target] ?? ''), token);
            store.setValue(target, next.text);
            if (!next.added) {
                return t('library.used.promptRemoved', { token });
            }
            return target === 'negativeprompt'
                ? t('library.used.negativeInserted', { token })
                : t('library.used.promptInserted', { token });
        },
        [param, schema, applyLinkedPresets, subtype, loras]
    );

    return { label, use, inUse };
}
