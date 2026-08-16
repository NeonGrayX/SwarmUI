import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { isModelCard, previewUrl, type ModelCard, type ModelSubtype, type WildcardCard } from '@/library/types';
import { Field } from '../form/Field';

/** Side sheet showing a model's details, with inline metadata editing.
 *
 * The legacy equivalent is a Bootstrap modal of ~20 unaligned `<div>Label: <input></div>` rows
 * (GenTabModals.cshtml:132-170). This reuses the same <Field> primitive as the parameter panel,
 * so labels and controls line up and every row gets the same help/reset treatment. */
export function ModelDetailSheet(props: {
    file: ModelCard | WildcardCard;
    subtype: ModelSubtype;
    canEdit: boolean;
    onClose: () => void;
}) {
    const card = isModelCard(props.file) ? props.file : null;
    const [draft, setDraft] = useState(() => toDraft(card));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    useEffect(() => {
        setDraft(toDraft(isModelCard(props.file) ? props.file : null));
        setError(null);
    }, [props.file]);

    // Escape closes, matching every other overlay in this UI.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                props.onClose();
            }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [props]);

    const image = previewUrl(card ? card.preview_image : (props.file as WildcardCard).image);
    const dirty = card !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(card));

    async function save() {
        if (!card) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await api.post('EditModelMetadata', {
                model: card.name,
                subtype: props.subtype,
                title: draft.title,
                author: draft.author,
                type: draft.architecture,
                description: draft.description,
                standard_width: Number(draft.standard_width) || 0,
                standard_height: Number(draft.standard_height) || 0,
                usage_hint: draft.usage_hint,
                date: draft.date,
                license: draft.license,
                trigger_phrase: draft.trigger_phrase,
                prediction_type: draft.prediction_type,
                tags: draft.tags
            });
            await queryClient.invalidateQueries({ queryKey: ['models'] });
            props.onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save metadata.');
        }
        finally {
            setSaving(false);
        }
    }

    return (
        <aside
            aria-label="Model details"
            className="flex w-96 shrink-0 flex-col border-l border-subtle bg-surface"
            style={{ ['--sw-field-label-width' as string]: '7rem' }}
        >
            <div className="flex shrink-0 items-start gap-2 border-b border-subtle p-3">
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-medium text-fg-strong" title={props.file.name}>
                        {card?.title || props.file.name.split('/').pop()}
                    </h2>
                    <p className="truncate font-mono text-[11px] text-fg-soft" title={props.file.name}>
                        {props.file.name}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={props.onClose}
                    aria-label="Close details"
                    className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <X size={15} aria-hidden />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {image && (
                    <img
                        src={image}
                        alt=""
                        className="mb-3 w-full rounded border border-subtle object-cover"
                    />
                )}

                {card === null ? (
                    <WildcardBody file={props.file as WildcardCard} />
                ) : props.canEdit ? (
                    <>
                        <Editable label="Title" value={draft.title} onChange={v => setDraft({ ...draft, title: v })} />
                        <Editable label="Author" value={draft.author} onChange={v => setDraft({ ...draft, author: v })} />
                        <Editable
                            label="Architecture"
                            value={draft.architecture}
                            onChange={v => setDraft({ ...draft, architecture: v })}
                        />
                        <Editable
                            label="Prediction type"
                            value={draft.prediction_type}
                            onChange={v => setDraft({ ...draft, prediction_type: v })}
                        />
                        <Field id="res" label="Resolution" density="compact">
                            <div className="flex items-center gap-1">
                                <NumberBox
                                    value={draft.standard_width}
                                    onChange={v => setDraft({ ...draft, standard_width: v })}
                                    label="Width"
                                />
                                <span className="text-fg-soft">×</span>
                                <NumberBox
                                    value={draft.standard_height}
                                    onChange={v => setDraft({ ...draft, standard_height: v })}
                                    label="Height"
                                />
                            </div>
                        </Field>
                        <Editable label="License" value={draft.license} onChange={v => setDraft({ ...draft, license: v })} />
                        <Editable label="Date" value={draft.date} onChange={v => setDraft({ ...draft, date: v })} />
                        <Editable
                            label="Trigger phrase"
                            value={draft.trigger_phrase}
                            onChange={v => setDraft({ ...draft, trigger_phrase: v })}
                        />
                        <Editable
                            label="Usage hint"
                            value={draft.usage_hint}
                            onChange={v => setDraft({ ...draft, usage_hint: v })}
                        />
                        <Editable label="Tags" value={draft.tags} onChange={v => setDraft({ ...draft, tags: v })} />
                        <Field id="desc" label="Description" density="compact">
                            <textarea
                                rows={4}
                                value={draft.description}
                                onChange={e => setDraft({ ...draft, description: e.target.value })}
                                className="w-full resize-y rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                            />
                        </Field>
                        <Facts card={card} />
                    </>
                ) : (
                    <>
                        <ReadOnly label="Author" value={card.author} />
                        <ReadOnly label="Architecture" value={card.class} />
                        <ReadOnly label="Resolution" value={card.resolution} />
                        <ReadOnly label="License" value={card.license} />
                        <ReadOnly label="Trigger phrase" value={card.trigger_phrase} />
                        {card.description && (
                            <p className="mt-2 whitespace-pre-wrap text-sm text-fg-soft">{card.description}</p>
                        )}
                        <Facts card={card} />
                    </>
                )}
            </div>

            {card && props.canEdit && (
                <div className="shrink-0 border-t border-subtle p-3">
                    {error && (
                        <p className="mb-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {error}
                        </p>
                    )}
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setDraft(toDraft(card))}
                            disabled={!dirty || saving}
                            className="rounded border border-default px-3 py-1.5 text-sm text-fg disabled:opacity-40 hover:bg-[var(--sw-hover)]"
                        >
                            Discard
                        </button>
                        <button
                            type="button"
                            onClick={save}
                            disabled={!dirty || saving}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--emphasis-text)' }}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
            )}
        </aside>
    );
}

function toDraft(card: ModelCard | null) {
    return {
        title: card?.title ?? '',
        author: card?.author ?? '',
        architecture: card?.architecture ?? '',
        prediction_type: card?.prediction_type ?? '',
        description: card?.description ?? '',
        standard_width: String(card?.standard_width ?? 0),
        standard_height: String(card?.standard_height ?? 0),
        license: card?.license ?? '',
        date: card?.date ?? '',
        trigger_phrase: card?.trigger_phrase ?? '',
        usage_hint: card?.usage_hint ?? '',
        tags: (card?.tags ?? []).join(', ')
    };
}

function Editable(props: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <Field id={props.label} label={props.label} density="compact">
            <input
                type="text"
                value={props.value}
                onChange={e => props.onChange(e.target.value)}
                className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
            />
        </Field>
    );
}

function NumberBox(props: { value: string; onChange: (value: string) => void; label: string }) {
    return (
        <input
            type="number"
            aria-label={props.label}
            value={props.value}
            onChange={e => props.onChange(e.target.value)}
            className="w-20 rounded border border-default bg-surface-sunken px-1 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
        />
    );
}

function ReadOnly(props: { label: string; value: string | null }) {
    if (!props.value) {
        return null;
    }
    return (
        <Field id={props.label} label={props.label} density="compact">
            <span className="text-sm text-fg">{props.value}</span>
        </Field>
    );
}

/** Immutable technical facts, always read-only. */
function Facts(props: { card: ModelCard }) {
    const { card } = props;
    return (
        <dl className="mt-3 space-y-1 border-t border-subtle pt-3 text-xs">
            <Fact label="Format" value={card.special_format || (card.is_supported_model_format ? 'supported' : 'unsupported')} />
            <Fact label="Compat class" value={card.compat_class} />
            <Fact label="Hash" value={card.hash ? `${card.hash.slice(0, 16)}…` : null} />
            <Fact
                label="Modified"
                value={card.time_modified ? new Date(card.time_modified * 1000).toLocaleString() : null}
            />
        </dl>
    );
}

function Fact(props: { label: string; value: string | null }) {
    if (!props.value) {
        return null;
    }
    return (
        <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-fg-soft">{props.label}</dt>
            <dd className="min-w-0 flex-1 break-words font-mono text-fg-soft">{props.value}</dd>
        </div>
    );
}

function WildcardBody(props: { file: WildcardCard }) {
    return (
        <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-fg-soft">Entries</h3>
            <pre className="whitespace-pre-wrap break-words rounded border border-subtle bg-surface-sunken p-2 font-mono text-[11px] text-fg-soft">
                {props.file.raw || '(empty)'}
            </pre>
        </div>
    );
}
