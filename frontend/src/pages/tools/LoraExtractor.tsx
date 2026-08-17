import { useState } from 'react';
import { useModels } from '@/library/hooks';
import { isModelCard } from '@/library/types';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { useJobStore } from '@/tools/jobs';

export function LoraExtractorPage() {
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
            title="LoRA Extractor"
            summary="Distill the difference between two checkpoints into a reusable LoRA."
            about={
                <>
                    <p>
                        Given an original model and a fine-tuned version of it, this computes what
                        changed and stores it as a LoRA, which is far smaller than the full model.
                    </p>
                    <p>
                        Rank controls how much detail is kept. Higher rank captures more of the
                        difference at the cost of file size; 32 is a reasonable starting point.
                        Valid range is 1 to 320.
                    </p>
                    <p>
                        Both models must share an architecture. Extraction is GPU-heavy and can take
                        several minutes.
                    </p>
                </>
            }
            warning={
                <>
                    Requires a running backend with enough VRAM to hold both models. The result is
                    only meaningful if the two models share a base architecture.
                </>
            }
            action={
                <button
                    type="button"
                    disabled={!canRun}
                    onClick={() =>
                        run({
                            title: `Extract LoRA: ${outName.trim()}`,
                            route: 'DoLoraExtractionWS',
                            payload: { baseModel, otherModel, rank, outName: outName.trim() }
                        })
                    }
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--emphasis-text)' }}
                >
                    Extract LoRA
                </button>
            }
        >
            {options.length === 0 && (
                <p className="mb-3 text-sm text-fg-soft">
                    No models installed, so there is nothing to extract from yet.
                </p>
            )}

            <Field
                id="lx-base"
                label="Base model"
                description="The original, unmodified model."
                density="compact"
            >
                <ModelSelect id="lx-base" value={baseModel} onChange={setBaseModel} options={options} />
            </Field>

            <Field
                id="lx-other"
                label="Tuned model"
                description="The fine-tuned model to compare against the base."
                density="compact"
            >
                <ModelSelect id="lx-other" value={otherModel} onChange={setOtherModel} options={options} />
            </Field>

            {baseModel && baseModel === otherModel && (
                <p className="mb-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    Pick two different models — comparing a model to itself produces nothing.
                </p>
            )}

            <Field id="lx-rank" label="Rank" description="1 to 320. Higher keeps more detail." density="compact">
                <div className="flex items-center gap-2">
                    <input
                        type="range"
                        aria-label="Rank slider"
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

            <Field id="lx-out" label="Save as" density="compact">
                <input
                    id="lx-out"
                    type="text"
                    value={outName}
                    onChange={e => setOutName(e.target.value)}
                    placeholder="my-extracted-lora"
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
    return (
        <select
            id={props.id}
            value={props.value}
            onChange={e => props.onChange(e.target.value)}
            disabled={props.options.length === 0}
            className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)] disabled:cursor-not-allowed"
        >
            <option value="">(select a model)</option>
            {props.options.map(option => (
                <option key={option} value={option}>
                    {option}
                </option>
            ))}
        </select>
    );
}
