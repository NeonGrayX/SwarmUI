import { useState } from 'react';
import { useModels } from '@/library/hooks';
import { isModelCard } from '@/library/types';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { useJobStore } from '@/tools/jobs';
import { useTranslation } from '@/i18n';

export function LoraExtractorPage() {
    const { t } = useTranslation();
    const models = useModels('Stable-Diffusion', '', 'Name', false, 3);
    const run = useJobStore(s => s.run);

    const [baseModel, setBaseModel] = useState('');
    const [otherModel, setOtherModel] = useState('');
    const [rank, setRank] = useState(32);
    const [outName, setOutName] = useState('');

    const options = (models.data?.files ?? []).filter(isModelCard).map(m => m.name);
    const canRun =
        baseModel && otherModel && baseModel !== otherModel && outName.trim() && rank >= 1 && rank <= 320;

    return (
        <ToolLayout
            title={t('nav.destination.lora-extractor')}
            summary={t('loraExtract.summary')}
            about={
                <>
                    <p>{t('loraExtract.about1')}</p>
                    <p>{t('loraExtract.about2')}</p>
                    <p>{t('loraExtract.about3')}</p>
                </>
            }
            warning={t('loraExtract.warning')}
            action={
                <button
                    type="button"
                    disabled={!canRun}
                    onClick={() =>
                        run({
                            title: t('loraExtract.jobTitle', { name: outName.trim() }),
                            route: 'DoLoraExtractionWS',
                            payload: { baseModel, otherModel, rank, outName: outName.trim() }
                        })
                    }
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {t('loraExtract.extract')}
                </button>
            }
        >
            {options.length === 0 && (
                <p className="mb-3 text-sm text-fg-soft">{t('loraExtract.noModels')}</p>
            )}

            <Field
                id="lx-base"
                label={t('loraExtract.baseModel')}
                description={t('loraExtract.baseModelHelp')}
                density="compact"
            >
                <ModelSelect id="lx-base" value={baseModel} onChange={setBaseModel} options={options} />
            </Field>

            <Field
                id="lx-other"
                label={t('loraExtract.tunedModel')}
                description={t('loraExtract.tunedModelHelp')}
                density="compact"
            >
                <ModelSelect id="lx-other" value={otherModel} onChange={setOtherModel} options={options} />
            </Field>

            {baseModel && baseModel === otherModel && (
                <p className="mb-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {t('loraExtract.sameModel')}
                </p>
            )}

            <Field
                id="lx-rank"
                label={t('loraExtract.rank')}
                description={t('loraExtract.rankHelp')}
                density="compact"
            >
                <div className="flex items-center gap-2">
                    <input
                        type="range"
                        aria-label={t('control.slider', { label: t('loraExtract.rank') })}
                        min={1}
                        max={320}
                        value={rank}
                        onChange={e => setRank(Number(e.target.value))}
                        className="min-w-12 flex-1 accent-[var(--emphasis)]"
                    />
                    <input
                        id="lx-rank"
                        type="number"
                        min={1}
                        max={320}
                        value={rank}
                        onChange={e => setRank(Number(e.target.value))}
                        className="w-16 rounded border border-default bg-surface-sunken px-1 py-1 text-right text-sm tabular-nums text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                </div>
            </Field>

            <Field id="lx-out" label={t('common.saveAs')} density="compact">
                <input
                    id="lx-out"
                    type="text"
                    value={outName}
                    onChange={e => setOutName(e.target.value)}
                    placeholder={t('loraExtract.namePlaceholder')}
                    className="w-full rounded border border-default bg-surface-sunken px-2 py-1 font-mono text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />
            </Field>
        </ToolLayout>
    );
}

function ModelSelect(props: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    options: string[];
}) {
    const { t } = useTranslation();
    return (
        <select
            id={props.id}
            value={props.value}
            onChange={e => props.onChange(e.target.value)}
            disabled={props.options.length === 0}
            className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)] disabled:cursor-not-allowed"
        >
            <option value="">{t('loraExtract.selectModel')}</option>
            {props.options.map(option => (
                <option key={option} value={option}>
                    {option}
                </option>
            ))}
        </select>
    );
}
