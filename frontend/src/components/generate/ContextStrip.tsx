import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { ModelOptionList, ModelPicker } from '@/components/form/ModelPicker';
import { isArchCompatible, subtypeNoun, useCurrentModel, useModelCatalog } from '@/library/catalog';
import { useLoraSelection } from '@/params/loras';
import { useParamStore } from '@/params/store';
import { useTranslation } from '@/i18n';

/** Id of the model picker, so the composer's "no model selected" notice can jump to it. */
export const MODEL_SELECT_ID = 'context-model';

/** Model / LoRA / preset context, always in view under the canvas. Both controls are the same
 *  pickers the parameter panel uses, so what is on screen and what will be generated cannot drift
 *  apart. */
export function ContextStrip() {
    const { t } = useTranslation();
    const model = useCurrentModel();
    const selection = useLoraSelection();
    const setValue = useParamStore(s => s.setValue);

    return (
        // The LoRA chips wrap, and a dozen of them would push the prompt off a phone screen, so
        // below `lg` the strip scrolls within a fixed budget instead of growing without bound.
        <div className="flex max-h-20 flex-wrap items-center gap-x-4 gap-y-1 overflow-y-auto border-t border-subtle bg-surface px-3 py-1.5 text-xs lg:max-h-none lg:overflow-visible">
            <span className="flex min-w-0 items-center gap-1.5">
                <label className="text-fg-soft" htmlFor={MODEL_SELECT_ID}>
                    {t('context.model')}
                </label>
                <span className="w-56 max-w-full sm:w-64">
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
                <span className="text-fg-soft">{t('context.loras')}</span>
                {selection.selected.length === 0 && <span className="text-fg-soft">{t('context.none')}</span>}
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
    const { t } = useTranslation();
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
                    title={t('lora.incompatible', {
                        builtFor: option?.shortCode ?? t('lora.otherBaseModel'),
                        current: current.label ?? t('lora.differentFamily')
                    })}
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
                aria-label={t('lora.remove', { name: props.name })}
                className="rounded-full p-0.5 hover:bg-black/20"
            >
                <X size={10} aria-hidden />
            </button>
        </span>
    );
}

function AddLoraButton(props: { selected: string[]; onToggle: (name: string, weight?: number | null) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={t('context.addLora')}
                    title={t('context.addLora')}
                    className="inline-flex items-center gap-0.5 rounded-full border border-default px-1.5 py-0.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                >
                    <Plus size={11} aria-hidden />
                    {t('common.add')}
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
