import { X } from 'lucide-react';
import { useSession, useT2IParams } from '@/api/hooks';
import { useParamStore } from '@/params/store';

/** Model / LoRA / preset context, as removable chips.
 *
 * Replaces #bottom_info_bar, which renders a run-on line of "<b>Label</b>: value" spans with no
 * affordance to clear any of them. */
export function ContextStrip() {
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const values = useParamStore(s => s.values);
    const setValue = useParamStore(s => s.setValue);

    const modelOptions = params.data?.models?.['Stable-Diffusion']?.map(entry => entry[0]) ?? [];
    const model = String(values.model ?? '');
    const loras = Array.isArray(values.loras) ? values.loras : [];

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-subtle bg-surface px-3 py-1.5 text-xs">
            <label className="flex items-center gap-1.5">
                <span className="text-fg-soft">Model</span>
                <select
                    value={model}
                    onChange={e => setValue('model', e.target.value)}
                    className="max-w-64 rounded border border-default bg-surface-sunken px-1.5 py-0.5 text-xs text-fg outline-none focus:border-[var(--emphasis)]"
                >
                    <option value="">
                        {modelOptions.length === 0 ? '(no models installed)' : '(none selected)'}
                    </option>
                    {modelOptions.map(option => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            </label>

            <span className="flex items-center gap-1.5">
                <span className="text-fg-soft">LoRAs</span>
                {loras.length === 0 ? (
                    <span className="text-fg-soft">none</span>
                ) : (
                    loras.map(lora => (
                        <Chip
                            key={lora}
                            label={lora}
                            onRemove={() => setValue('loras', loras.filter(l => l !== lora))}
                        />
                    ))
                )}
            </span>
        </div>
    );
}

function Chip(props: { label: string; onRemove: () => void }) {
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{ background: 'var(--emphasis-soft)', color: 'var(--text-strong)' }}
        >
            <span className="max-w-40 truncate">{props.label}</span>
            <button
                type="button"
                onClick={props.onRemove}
                aria-label={`Remove ${props.label}`}
                className="rounded-full p-0.5 hover:bg-black/20"
            >
                <X size={10} aria-hidden />
            </button>
        </span>
    );
}
