import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { ModelOptionList, ModelPicker } from '@/components/form/ModelPicker';
import { isArchCompatible, subtypeNoun, useCurrentModel, useModelCatalog } from '@/library/catalog';
import { useLoraSelection } from '@/params/loras';
import { useParamStore } from '@/params/store';

/** Id of the model picker, so the composer's "no model selected" notice can jump to it. */
export const MODEL_SELECT_ID = 'context-model';

/** Model / LoRA / preset context, always in view under the canvas.
 *
 * Replaces #bottom_info_bar, which renders a run-on line of "<b>Label</b>: value" spans with no
 * affordance to change or clear any of them. Both controls here are the same pickers the parameter
 * panel uses, so what is on screen and what will be generated cannot drift apart.
 */
export function ContextStrip() {
    const model = useCurrentModel();
    const selection = useLoraSelection();
    const setValue = useParamStore(s => s.setValue);

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-subtle bg-surface px-3 py-1.5 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
                <label className="text-fg-soft" htmlFor={MODEL_SELECT_ID}>
                    Model
                </label>
                <span className="w-64 max-w-full">
                    <ModelPicker
                        id={MODEL_SELECT_ID}
                        subtype="Stable-Diffusion"
                        value={model.name}
                        onChange={next => setValue('model', next)}
                        compact
                        eager
                    />
                </span>
            </span>

            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-fg-soft">LoRAs</span>
                {selection.selected.length === 0 && <span className="text-fg-soft">none</span>}
                {selection.selected.map(lora => (
                    <LoraChip
                        key={lora.name}
                        name={lora.name}
                        weight={lora.weight}
                        onRemove={() => selection.remove(lora.name)}
                    />
                ))}
                <AddLoraButton selected={selection.names} onToggle={selection.toggle} />
            </span>
        </div>
    );
}

/** One applied LoRA. The weight is on the chip because it is the number people change most, and
 *  reading it back is otherwise a trip into the parameter panel. */
function LoraChip(props: { name: string; weight: string; onRemove: () => void }) {
    const catalog = useModelCatalog('LoRA');
    const current = useCurrentModel();
    const option = catalog.byName.get(props.name);
    const incompatible =
        option !== undefined && current.compatClass !== null && !isArchCompatible(option, current.compatClass);

    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{ background: 'var(--sw-chip-bg)', color: 'var(--text)' }}
            title={props.name}
        >
            {incompatible && (
                <span
                    title={`Built for ${option?.shortCode ?? 'another base model'}, but the selected model is ${current.label ?? 'a different family'}. This LoRA will not apply correctly.`}
                    style={{ color: 'var(--backend-errored)' }}
                >
                    <AlertTriangle size={10} aria-hidden />
                </span>
            )}
            <span className="max-w-40 truncate">{option?.leaf ?? props.name}</span>
            <span className="tabular-nums opacity-70">{props.weight}</span>
            <button
                type="button"
                onClick={props.onRemove}
                aria-label={`Remove ${props.name}`}
                className="rounded-full p-0.5 hover:bg-black/20"
            >
                <X size={10} aria-hidden />
            </button>
        </span>
    );
}

function AddLoraButton(props: { selected: string[]; onToggle: (name: string, weight?: number | null) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label="Add a LoRA"
                    title="Add a LoRA"
                    className="inline-flex items-center gap-0.5 rounded-full border border-default px-1.5 py-0.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                >
                    <Plus size={11} aria-hidden />
                    Add
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="start"
                    side="top"
                    sideOffset={6}
                    collisionPadding={8}
                    className="z-50 w-[min(28rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl"
                >
                    <ModelOptionList
                        subtype="LoRA"
                        noun={subtypeNoun('LoRA')}
                        selected={props.selected}
                        onPick={option => props.onToggle(option.name, option.defaultWeight)}
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
