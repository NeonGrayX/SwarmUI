import { useState } from 'react';
import { create } from 'zustand';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { BASE_SUBTYPE, useCurrentModel, useModelCatalog } from '@/library/catalog';
import type { NormalizedSchema } from '@/params/schema';
import { valueOf } from '@/params/store';
import { toStoredString } from '@/params/presets';
import {
    applySuggestions,
    useSuggestedSettings,
    useSuggestionState,
    type Suggestion,
    type SuggestionSource
} from '@/params/suggest';
import { useTranslation, type Translator } from '@/i18n';

/** Models whose suggestions were dismissed this session. Not persisted: a dismissal is "not now",
 *  and the next visit should offer them again. */
const useDismissed = create<{ models: Set<string>; dismiss: (name: string) => void }>(set => ({
    models: new Set(),
    dismiss: name => set(s => ({ models: new Set(s.models).add(name) }))
}));

/** How a param's value reads in the list: the dropdown's display name where it has one. */
function describeValue(suggestion: Suggestion, raw: string | null, t: Translator): string {
    if (raw === null) {
        return t.t('suggest.modelDefault');
    }
    const param = suggestion.param;
    const index = param.values?.indexOf(raw) ?? -1;
    const name = index >= 0 ? param.value_names?.[index] : null;
    return name ? t.tDynamic(name) : raw;
}

function describeSource(source: SuggestionSource, family: string, t: Translator): string {
    switch (source.kind) {
        case 'family':
            return t.t('suggest.source.family', { family });
        case 'variant':
            return t.t('suggest.source.variant', { marker: source.marker });
        case 'hint':
            return t.t('suggest.source.hint', { hint: source.hint });
        case 'civitai':
            return t.t('suggest.source.civitai', { count: source.count });
    }
}

/** Offers the settings the selected base model is known to want, where the panel differs.
 *
 * Shows nothing once the panel matches, so applying is its own confirmation. */
export function SuggestedSettings(props: { schema: NormalizedSchema }) {
    const translator = useTranslation();
    const { t } = translator;
    const [open, setOpen] = useState(false);
    const current = useCurrentModel();
    const catalog = useModelCatalog(BASE_SUBTYPE);
    const option = current.name ? catalog.byName.get(current.name) : undefined;
    const { values, toggles } = useSuggestionState();
    const dismissed = useDismissed(s => s.models.has(current.name));
    const dismiss = useDismissed(s => s.dismiss);

    const suggested = useSuggestedSettings(props.schema, {
        name: current.name,
        title: option?.title ?? null,
        architecture: current.architecture,
        compatClass: current.compatClass,
        description: option?.description ?? null,
        usageHint: option?.usageHint ?? null
    });

    if (!current.name || dismissed || suggested.changes.length === 0) {
        return null;
    }
    const family = current.label ?? current.architecture ?? t('suggest.unknownFamily');

    return (
        <section
            className="mb-2 rounded border border-subtle text-xs"
            style={{ background: 'var(--sw-chip-bg)' }}
            aria-label={t('suggest.title')}
        >
            <div className="flex items-center gap-1.5 px-1.5 py-1">
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded px-0.5 py-0.5 text-left hover:bg-[var(--sw-hover)]"
                >
                    <ChevronRight
                        size={13}
                        aria-hidden
                        className={`shrink-0 text-fg-soft transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                    <Sparkles size={13} aria-hidden className="shrink-0 text-[var(--emphasis)]" />
                    <span className="truncate font-medium text-fg-strong">
                        {t('suggest.summary', { count: suggested.changes.length, family })}
                    </span>
                </button>
                <button
                    type="button"
                    onClick={() => applySuggestions(suggested.changes, props.schema)}
                    className="shrink-0 rounded border border-default px-2 py-0.5 text-xs text-fg hover:bg-[var(--sw-hover)]"
                >
                    {t('suggest.apply')}
                </button>
                <button
                    type="button"
                    onClick={() => dismiss(current.name)}
                    aria-label={t('suggest.dismiss')}
                    title={t('suggest.dismiss')}
                    className="shrink-0 rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <X size={13} aria-hidden />
                </button>
            </div>
            {open && (
                <div className="border-t border-subtle px-2 py-1.5">
                    <ul className="space-y-1">
                        {suggested.changes.map(change => {
                            const param = change.param;
                            const now =
                                param.toggleable && toggles[param.id] !== true
                                    ? null
                                    : toStoredString(valueOf(param, values));
                            return (
                                <li key={param.id} className="flex flex-wrap items-baseline gap-x-1.5">
                                    <span className="text-fg-strong">{translator.tDynamic(param.name)}</span>
                                    <span className="text-fg-soft">{describeValue(change, now, translator)}</span>
                                    <span aria-hidden className="text-fg-soft">→</span>
                                    <span className="font-medium text-fg">
                                        {describeValue(change, change.value === null ? null : String(change.value), translator)}
                                    </span>
                                    <span className="basis-full text-[11px] text-fg-soft">
                                        {describeSource(change.source, family, translator)}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    {suggested.loadingCivitai && (
                        <p className="mt-1 text-[11px] text-fg-soft">{t('suggest.loadingCivitai')}</p>
                    )}
                    <p className="mt-1.5 text-[11px] text-fg-soft">{t('suggest.note')}</p>
                </div>
            )}
        </section>
    );
}
