import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { isArchCompatible, subtypeNoun, useCurrentModel, useModelCatalog } from '@/library/catalog';
import { useParamSchema } from '@/params/schema';
import { useLoraSelection } from '@/params/loras';
import { ModelOptionList, ModelThumb } from './ModelPicker';
import { useTranslation } from '@/i18n';

/** The LoRA field: what is applied, at what weight, plus a picker to change it.
 *
 *  A LoRA trained against a different base model does nothing useful, so compatibility with the
 *  selected model is the picker's default filter, and anything already selected that stops
 *  matching is flagged in place. */

/** Fallbacks matching the LoRA Weights param registration (T2IParamTypes.cs:701), for the case
 *  where the schema has not loaded yet. */
const WEIGHT_MIN = -10;
const WEIGHT_MAX = 10;
const WEIGHT_STEP = 0.1;

export function LoraPicker(props: { inputId?: string; disabled?: boolean }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [everOpened, setEverOpened] = useState(false);
    const selection = useLoraSelection();
    // Worth fetching before the first open only when something is already selected, so those rows
    // can show a thumbnail and a compatibility verdict without being clicked first.
    const catalog = useModelCatalog('LoRA', everOpened || selection.selected.length > 0);
    const current = useCurrentModel();
    const schema = useParamSchema();
    const weightParam = schema?.byId.get('loraweights');

    return (
        <div className="min-w-0">
            {selection.selected.length > 0 && (
                <ul className="mb-1 space-y-1">
                    {selection.selected.map(lora => {
                        const option = catalog.byName.get(lora.name);
                        const incompatible =
                            option !== undefined &&
                            current.compatClass !== null &&
                            !isArchCompatible(option, current.compatClass);
                        return (
                            <li
                                key={lora.name}
                                className="flex items-center gap-1.5 rounded border border-subtle bg-surface px-1 py-1"
                                title={lora.name}
                            >
                                <ModelThumb option={option} size="sm" />
                                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                                    {option?.leaf ?? lora.name}
                                </span>
                                {incompatible && (
                                    <span
                                        title={t('lora.incompatible', {
                                            builtFor: option?.shortCode ?? t('lora.otherBaseModel'),
                                            current: current.label ?? t('lora.differentFamily')
                                        })}
                                        style={{ color: 'var(--backend-errored)' }}
                                    >
                                        <AlertTriangle size={13} aria-hidden />
                                    </span>
                                )}
                                <input
                                    type="number"
                                    aria-label={t('lora.weightFor', { name: lora.name })}
                                    title={t('lora.weight')}
                                    disabled={props.disabled}
                                    min={weightParam?.min ?? WEIGHT_MIN}
                                    max={weightParam?.max ?? WEIGHT_MAX}
                                    step={weightParam?.step || WEIGHT_STEP}
                                    value={lora.weight}
                                    onChange={e => selection.setWeight(lora.name, e.target.value)}
                                    // A box left empty mid-edit would reach the backend as an
                                    // unparseable weight, so it settles back to full strength.
                                    onBlur={e => {
                                        if (!Number.isFinite(Number(e.target.value)) || e.target.value === '') {
                                            selection.setWeight(lora.name, '1');
                                        }
                                    }}
                                    className="w-14 shrink-0 rounded border border-default bg-surface-sunken px-1 py-0.5 text-right text-xs text-fg tabular-nums outline-none focus:border-[var(--emphasis)]"
                                />
                                <button
                                    type="button"
                                    onClick={() => selection.remove(lora.name)}
                                    disabled={props.disabled}
                                    aria-label={t('lora.remove', { name: lora.name })}
                                    className="shrink-0 rounded p-0.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                                >
                                    <X size={12} aria-hidden />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div className="flex items-center gap-1">
                <Popover.Root
                    open={open}
                    onOpenChange={next => {
                        setOpen(next);
                        if (next) {
                            setEverOpened(true);
                        }
                    }}
                >
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            id={props.inputId}
                            disabled={props.disabled}
                            className="flex items-center gap-1 rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg-soft outline-none hover:border-[var(--emphasis)] hover:text-fg focus:border-[var(--emphasis)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Plus size={13} aria-hidden />
                            {t('lora.add')}
                        </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content
                            align="start"
                            sideOffset={4}
                            collisionPadding={8}
                            className="z-50 w-[min(28rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl"
                        >
                            {/* Multi-select: picking toggles and the list stays open, since adding
                                two or three LoRAs at once is the normal case. */}
                            <ModelOptionList
                                subtype="LoRA"
                                noun={subtypeNoun('LoRA')}
                                selected={selection.names}
                                onPick={option => selection.toggle(option.name, option.defaultWeight)}
                            />
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>

                {selection.selected.length > 1 && (
                    <button
                        type="button"
                        onClick={selection.clear}
                        disabled={props.disabled}
                        className="rounded px-1.5 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        {t('lora.removeAll')}
                    </button>
                )}
            </div>
        </div>
    );
}
