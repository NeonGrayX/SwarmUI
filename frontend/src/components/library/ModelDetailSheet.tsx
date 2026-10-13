import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useEditModelMetadata, useMyUserData, useSetPresetLink } from '@/library/hooks';
import { isPlaceholderImage, previewUrl, type ModelCard, type ModelSubtype } from '@/library/types';
import { cleanModelName, useParamSchema } from '@/params/schema';
import { Field } from '../form/Field';
import { DetailSheet } from '../ui/DetailSheet';
import { KEEP_PREVIEW, PreviewImageEditor, previewValue, type PreviewChange } from './PreviewImageEditor';
import { useTranslation } from '@/i18n';

/** Architecture id suffixes each browser's edit dialog offers, as legacy's ModelBrowserWrapper
 *  subIds (src/wwwroot/js/genpage/gentab/models.js): an option shows when the part after its slash
 *  is one of these, '' being the base models with no slash at all. Subtypes not listed get every
 *  architecture. */
const ARCH_SUFFIXES: Partial<Record<ModelSubtype, string[]>> = {
    'Stable-Diffusion': ['', 'inpaint', 'tensorrt', 'depth', 'canny', 'kontext'],
    VAE: ['vae'],
    LoRA: ['lora', 'lora-depth', 'lora-canny'],
    Embedding: ['embedding', 'textual-inversion'],
    ControlNet: ['controlnet', 'control-lora', 'control-diffpatch', 'controlnet-alimamainpaint']
};

/** The prediction types legacy's edit dialog offers (GenTabModals.cshtml, edit_model_prediction_type). */
const PREDICTION_TYPES: { id: string; labelKey: string }[] = [
    { id: '', labelKey: 'modelDetail.prediction.unspecified' },
    { id: 'v', labelKey: 'modelDetail.prediction.v' },
    { id: 'epsilon', labelKey: 'modelDetail.prediction.epsilon' },
    { id: 'x0', labelKey: 'modelDetail.prediction.x0' },
    { id: 'lcm', labelKey: 'modelDetail.prediction.lcm' },
    { id: 'v-zsnr', labelKey: 'modelDetail.prediction.vZsnr' },
    { id: 'sd3', labelKey: 'modelDetail.prediction.sd3' }
];

/** LoRA section confinement ids, as legacy's edit_model_lora_default_confinement. */
const CONFINEMENTS: { id: string; labelKey: string }[] = [
    { id: '', labelKey: 'modelDetail.confinement.unset' },
    { id: '0', labelKey: 'modelDetail.confinement.global' },
    { id: '5', labelKey: 'modelDetail.confinement.base' },
    { id: '1', labelKey: 'modelDetail.confinement.refiner' },
    { id: '2', labelKey: 'modelDetail.confinement.video' },
    { id: '3', labelKey: 'modelDetail.confinement.videoSwap' }
];

const INPUT_CLASS =
    'w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

function suffixOf(architecture: string): string {
    const slash = architecture.indexOf('/');
    return slash > 0 ? architecture.substring(slash + 1) : '';
}

function isLoraArch(subtype: ModelSubtype, architecture: string): boolean {
    return subtype === 'LoRA' || architecture.endsWith('/lora');
}

function isEmbeddingArch(subtype: ModelSubtype, architecture: string): boolean {
    return subtype === 'Embedding' || architecture.endsWith('/textual-inversion');
}

/** Side sheet showing a model's details, with inline metadata editing. Built from the same
 *  <Field> primitive as the parameter panel, so rows align and each gets the same help treatment.
 *
 *  EditModelMetadata overwrites every field it has a parameter for, so the save sends all of them,
 *  including the embedding and LoRA defaults this sheet only shows for those kinds of model -
 *  leaving one out would wipe it. */
export function ModelDetailSheet(props: {
    file: ModelCard;
    subtype: ModelSubtype;
    canEdit: boolean;
    /** Puts the model to use on the Generate form, labelled for what that means for this subtype. */
    use?: { label: string; onUse: () => void };
    onClose: () => void;
}) {
    const { t, tDynamic } = useTranslation();
    const card = props.file;
    const schema = useParamSchema();
    const userData = useMyUserData();
    const editMetadata = useEditModelMetadata();
    const setPresetLink = useSetPresetLink();

    const linkedPreset =
        userData.data?.model_preset_links?.[props.subtype]?.[cleanModelName(card.name)]?.[0] ?? '';

    const [draft, setDraft] = useState(() => toDraft(card));
    const [preview, setPreview] = useState<PreviewChange>(KEEP_PREVIEW);
    const [preset, setPreset] = useState(linkedPreset);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Another model opened in the same sheet starts a fresh edit. Keyed on the name rather than the
    // card, so a background refetch of the listing does not throw away what is being typed.
    useEffect(() => {
        setDraft(toDraft(card));
        setPreview(KEEP_PREVIEW);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [card.name]);
    useEffect(() => {
        setPreset(linkedPreset);
    }, [linkedPreset, card.name]);

    const architectures = useMemo(() => {
        const suffixes = ARCH_SUFFIXES[props.subtype];
        const all = Object.values(schema?.modelClasses ?? {});
        return all
            .filter(arch => !suffixes || suffixes.includes(suffixOf(arch.id)) || arch.id === card.architecture)
            .sort((a, b) => a.id.localeCompare(b.id));
    }, [schema, props.subtype, card.architecture]);

    const image = isPlaceholderImage(card.preview_image) ? undefined : previewUrl(card.preview_image);
    const dirty =
        JSON.stringify(draft) !== JSON.stringify(toDraft(card)) ||
        preview.kind !== 'keep' ||
        preset !== linkedPreset;

    async function save() {
        setSaving(true);
        setError(null);
        try {
            await editMetadata.mutateAsync({
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
                tags: draft.tags,
                is_negative_embedding: draft.is_negative_embedding,
                lora_default_weight: draft.lora_default_weight.trim(),
                lora_default_confinement: draft.lora_default_confinement,
                preview_image: previewValue(preview)
            });
            if (preset !== linkedPreset) {
                await setPresetLink.mutateAsync({ subtype: props.subtype, model: card.name, preset });
            }
            props.onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : t('modelDetail.saveFailed'));
        }
        finally {
            setSaving(false);
        }
    }

    const showLora = isLoraArch(props.subtype, draft.architecture);
    const showEmbedding = isEmbeddingArch(props.subtype, draft.architecture);
    const presets = userData.data?.presets ?? [];

    return (
        <DetailSheet
            label={t('modelDetail.title')}
            onClose={props.onClose}
            style={{ ['--sw-field-label-width' as string]: '7rem' } as React.CSSProperties}
        >
            <div className="flex shrink-0 items-start gap-2 border-b border-subtle p-3">
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-medium text-fg-strong" title={card.name}>
                        {card.title || card.name.split('/').pop()}
                    </h2>
                    <p className="truncate font-mono text-[11px] text-fg-soft" title={card.name}>
                        {card.name}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={props.onClose}
                    aria-label={t('common.closeDetails')}
                    className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <X size={15} aria-hidden />
                </button>
            </div>

            {props.use && (
                <div className="flex shrink-0 gap-2 border-b border-subtle px-3 py-2">
                    <button
                        type="button"
                        onClick={props.use.onUse}
                        className="rounded px-2 py-1 text-xs"
                        style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                    >
                        {props.use.label}
                    </button>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {props.canEdit ? (
                    <>
                        <Field id="preview" label={t('modelDetail.field.preview')} density="compact">
                            <PreviewImageEditor current={card.preview_image} value={preview} onChange={setPreview} />
                        </Field>
                        <Editable
                            id="title"
                            label={t('modelDetail.field.title')}
                            value={draft.title}
                            onChange={v => setDraft({ ...draft, title: v })}
                        />
                        <Editable
                            id="author"
                            label={t('modelDetail.field.author')}
                            value={draft.author}
                            onChange={v => setDraft({ ...draft, author: v })}
                        />
                        <Field id="architecture" label={t('modelDetail.field.architecture')} density="compact">
                            <select
                                id="architecture"
                                value={draft.architecture}
                                onChange={e => setDraft({ ...draft, architecture: e.target.value })}
                                className={INPUT_CLASS}
                            >
                                {/* An unclassified model has no id to show; picking one classifies it. */}
                                {(!draft.architecture || !architectures.some(a => a.id === draft.architecture)) && (
                                    <option value={draft.architecture}>
                                        {draft.architecture || t('modelDetail.architectureUnknown')}
                                    </option>
                                )}
                                {architectures.map(arch => (
                                    <option key={arch.id} value={arch.id}>
                                        {tDynamic(arch.name)}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field id="prediction-type" label={t('modelDetail.field.predictionType')} density="compact">
                            <select
                                id="prediction-type"
                                value={draft.prediction_type}
                                onChange={e => setDraft({ ...draft, prediction_type: e.target.value })}
                                className={INPUT_CLASS}
                            >
                                {!PREDICTION_TYPES.some(p => p.id === draft.prediction_type) && (
                                    <option value={draft.prediction_type}>{draft.prediction_type}</option>
                                )}
                                {PREDICTION_TYPES.map(type => (
                                    <option key={type.id} value={type.id}>
                                        {t(type.labelKey)}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field id="res" label={t('modelDetail.field.resolution')} density="compact">
                            <div className="flex items-center gap-1">
                                <NumberBox
                                    value={draft.standard_width}
                                    onChange={v => setDraft({ ...draft, standard_width: v })}
                                    label={t('modelDetail.field.width')}
                                />
                                <span className="text-fg-soft">×</span>
                                <NumberBox
                                    value={draft.standard_height}
                                    onChange={v => setDraft({ ...draft, standard_height: v })}
                                    label={t('modelDetail.field.height')}
                                />
                            </div>
                        </Field>
                        <Editable
                            id="license"
                            label={t('modelDetail.field.license')}
                            value={draft.license}
                            onChange={v => setDraft({ ...draft, license: v })}
                        />
                        <Editable
                            id="date"
                            label={t('modelDetail.field.date')}
                            value={draft.date}
                            onChange={v => setDraft({ ...draft, date: v })}
                        />
                        <Editable
                            id="trigger-phrase"
                            label={t('modelDetail.field.triggerPhrase')}
                            value={draft.trigger_phrase}
                            onChange={v => setDraft({ ...draft, trigger_phrase: v })}
                        />
                        <Editable
                            id="usage-hint"
                            label={t('modelDetail.field.usageHint')}
                            value={draft.usage_hint}
                            onChange={v => setDraft({ ...draft, usage_hint: v })}
                        />
                        <Editable
                            id="tags"
                            label={t('modelDetail.field.tags')}
                            value={draft.tags}
                            onChange={v => setDraft({ ...draft, tags: v })}
                        />
                        {showEmbedding && (
                            <Field id="is-negative" label={t('modelDetail.field.isNegative')} density="compact">
                                <label className="flex items-center gap-2 pt-1 text-xs text-fg-soft">
                                    <input
                                        id="is-negative"
                                        type="checkbox"
                                        checked={draft.is_negative_embedding}
                                        onChange={e => setDraft({ ...draft, is_negative_embedding: e.target.checked })}
                                        className="accent-[var(--emphasis)]"
                                    />
                                    {t('modelDetail.isNegativeHint')}
                                </label>
                            </Field>
                        )}
                        {showLora && (
                            <>
                                <Field id="lora-weight" label={t('modelDetail.field.loraWeight')} density="compact">
                                    <input
                                        id="lora-weight"
                                        type="number"
                                        min={-10}
                                        max={10}
                                        step={0.05}
                                        value={draft.lora_default_weight}
                                        placeholder="1"
                                        onChange={e => setDraft({ ...draft, lora_default_weight: e.target.value })}
                                        className="w-24 rounded border border-default bg-surface-sunken px-1 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                    />
                                </Field>
                                <Field id="lora-confinement" label={t('modelDetail.field.loraConfinement')} density="compact">
                                    <select
                                        id="lora-confinement"
                                        value={draft.lora_default_confinement}
                                        onChange={e => setDraft({ ...draft, lora_default_confinement: e.target.value })}
                                        className={INPUT_CLASS}
                                    >
                                        {!CONFINEMENTS.some(c => c.id === draft.lora_default_confinement) && (
                                            <option value={draft.lora_default_confinement}>
                                                {draft.lora_default_confinement}
                                            </option>
                                        )}
                                        {CONFINEMENTS.map(confinement => (
                                            <option key={confinement.id} value={confinement.id}>
                                                {t(confinement.labelKey)}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                            </>
                        )}
                        <Field id="linked-preset" label={t('modelDetail.field.linkedPreset')} density="compact">
                            <select
                                id="linked-preset"
                                value={preset}
                                onChange={e => setPreset(e.target.value)}
                                title={t('modelDetail.linkedPresetHint')}
                                className={INPUT_CLASS}
                            >
                                <option value="">{t('modelDetail.noPreset')}</option>
                                {preset && !presets.some(p => p.title === preset) && (
                                    <option value={preset}>{preset}</option>
                                )}
                                {presets.map(p => (
                                    <option key={p.title} value={p.title}>
                                        {p.title}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field id="desc" label={t('modelDetail.field.description')} density="compact">
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
                        {image && (
                            // Capped in the bottom sheet, where a full-width preview is tall enough to
                            // push every field below the fold.
                            <img
                                src={image}
                                alt=""
                                className="mb-3 max-h-64 w-full rounded border border-subtle object-cover lg:max-h-none"
                            />
                        )}
                        <ReadOnly id="author" label={t('modelDetail.field.author')} value={card.author} />
                        <ReadOnly
                            id="architecture"
                            label={t('modelDetail.field.architecture')}
                            value={card.class ? tDynamic(card.class) : card.architecture}
                        />
                        <ReadOnly id="res" label={t('modelDetail.field.resolution')} value={card.resolution} />
                        <ReadOnly id="license" label={t('modelDetail.field.license')} value={card.license} />
                        <ReadOnly id="date" label={t('modelDetail.field.date')} value={card.date} />
                        <ReadOnly
                            id="trigger-phrase"
                            label={t('modelDetail.field.triggerPhrase')}
                            value={card.trigger_phrase}
                        />
                        <ReadOnly id="usage-hint" label={t('modelDetail.field.usageHint')} value={card.usage_hint} />
                        <ReadOnly id="tags" label={t('modelDetail.field.tags')} value={(card.tags ?? []).join(', ')} />
                        {showLora && (
                            <ReadOnly
                                id="lora-weight"
                                label={t('modelDetail.field.loraWeight')}
                                value={card.lora_default_weight}
                            />
                        )}
                        {showEmbedding && card.is_negative_embedding && (
                            <ReadOnly
                                id="is-negative"
                                label={t('modelDetail.field.isNegative')}
                                value={t('common.yes')}
                            />
                        )}
                        {card.description && (
                            <p className="mt-2 whitespace-pre-wrap text-sm text-fg-soft">{card.description}</p>
                        )}
                        <Facts card={card} />
                    </>
                )}
            </div>

            {props.canEdit && (
                <div className="shrink-0 border-t border-subtle p-3">
                    {error && (
                        <p className="mb-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {error}
                        </p>
                    )}
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setDraft(toDraft(card));
                                setPreview(KEEP_PREVIEW);
                                setPreset(linkedPreset);
                            }}
                            disabled={!dirty || saving}
                            className="rounded border border-default px-3 py-1.5 text-sm text-fg disabled:opacity-40 hover:bg-[var(--sw-hover)]"
                        >
                            {t('common.discard')}
                        </button>
                        <button
                            type="button"
                            onClick={save}
                            disabled={!dirty || saving}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {saving ? t('common.saving') : t('common.save')}
                        </button>
                    </div>
                </div>
            )}
        </DetailSheet>
    );
}

function toDraft(card: ModelCard) {
    return {
        title: card.title ?? '',
        author: card.author ?? '',
        architecture: card.architecture ?? '',
        prediction_type: card.prediction_type ?? '',
        description: card.description ?? '',
        standard_width: String(card.standard_width ?? 0),
        standard_height: String(card.standard_height ?? 0),
        license: card.license ?? '',
        date: card.date ?? '',
        trigger_phrase: card.trigger_phrase ?? '',
        usage_hint: card.usage_hint ?? '',
        tags: (card.tags ?? []).join(', '),
        is_negative_embedding: card.is_negative_embedding ?? false,
        lora_default_weight: card.lora_default_weight ?? '',
        lora_default_confinement: card.lora_default_confinement ?? ''
    };
}

function Editable(props: { id: string; label: string; value: string; onChange: (value: string) => void }) {
    return (
        <Field id={props.id} label={props.label} density="compact">
            <input
                id={props.id}
                type="text"
                value={props.value}
                onChange={e => props.onChange(e.target.value)}
                className={INPUT_CLASS}
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

function ReadOnly(props: { id: string; label: string; value: string | null }) {
    if (!props.value) {
        return null;
    }
    return (
        <Field id={props.id} label={props.label} density="compact">
            <span className="text-sm text-fg">{props.value}</span>
        </Field>
    );
}

/** Immutable technical facts, always read-only. */
function Facts(props: { card: ModelCard }) {
    const { t } = useTranslation();
    const { card } = props;
    return (
        <dl className="mt-3 space-y-1 border-t border-subtle pt-3 text-xs">
            <Fact
                label={t('modelDetail.fact.format')}
                value={
                    card.special_format ||
                    (card.is_supported_model_format
                        ? t('modelDetail.format.supported')
                        : t('modelDetail.format.unsupported'))
                }
            />
            <Fact label={t('modelDetail.fact.compatClass')} value={card.compat_class} />
            <Fact label={t('modelDetail.fact.hash')} value={card.hash ? `${card.hash.slice(0, 16)}…` : null} />
            <Fact
                label={t('modelDetail.fact.modified')}
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
