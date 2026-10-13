import { useId } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from '@/i18n';

/** Shared input styling for the prompt syntax dialogs, matching the param panel's controls. */
export const SYNTAX_INPUT_CLASS =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)] disabled:cursor-not-allowed disabled:opacity-50';

/** Rounds to two decimals and prints without float noise, as roundToStrAuto(x, 0.01) does
 *  (src/wwwroot/js/util.js). */
export function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** The frame both prompt syntax dialogs share: title, intro prose, a docs link, the fields, and an
 *  Add button that `canAdd` gates, with `error` saying why when it does not. */
export function SyntaxDialog(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    intro: string;
    docsUrl: string;
    docsLabel: string;
    canAdd: boolean;
    error?: string;
    onAdd: () => void;
    children: React.ReactNode;
}) {
    const { t } = useTranslation();
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(40rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-default bg-surface-raised shadow-2xl">
                    <Dialog.Title className="px-4 pt-4 text-base font-medium text-fg-strong">{props.title}</Dialog.Title>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                        <Dialog.Description className="whitespace-pre-line text-xs text-fg-soft">
                            {props.intro}{' '}
                            <a href={props.docsUrl} target="_blank" rel="noreferrer noopener" className="underline hover:text-fg">
                                {props.docsLabel}
                            </a>
                        </Dialog.Description>
                        <p className="text-xs text-fg-soft">{t('promptTools.advancedNote')}</p>
                        <hr className="border-subtle" />
                        {props.children}
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-subtle px-4 py-3">
                        {props.error && (
                            <span className="mr-auto text-xs" style={{ color: 'var(--backend-errored)' }}>
                                {props.error}
                            </span>
                        )}
                        <Dialog.Close asChild>
                            <button type="button" className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]">
                                {t('common.cancel')}
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            disabled={!props.canAdd}
                            onClick={props.onAdd}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {t('common.add')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** One labelled row. `help` is the legacy field's popover text, shown on hover over the label. */
export function SyntaxField(props: { label: string; help: string; children: (id: string) => React.ReactNode }) {
    const id = useId();
    return (
        <div className="grid grid-cols-[minmax(7rem,9rem)_1fr] items-center gap-2">
            <label htmlFor={id} title={props.help} className="cursor-help text-sm text-fg-soft">
                {props.label}
            </label>
            <div className="flex min-w-0 items-center gap-2">{props.children(id)}</div>
        </div>
    );
}

/** A 0-1 slider with an editable number beside it. */
export function UnitSlider(props: { id: string; label: string; value: number; step: number; onChange: (value: number) => void }) {
    return (
        <>
            <input
                type="range"
                aria-label={props.label}
                min={0}
                max={1}
                step={props.step}
                value={props.value}
                onChange={e => props.onChange(Number(e.target.value))}
                className="min-w-12 flex-1 accent-[var(--emphasis)]"
            />
            <input
                id={props.id}
                type="number"
                min={0}
                max={1}
                step={props.step}
                value={props.value}
                onChange={e => props.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                className={`${SYNTAX_INPUT_CLASS} w-16 shrink-0 px-1 text-right tabular-nums`}
            />
        </>
    );
}

/** An optional dropdown: off means "leave the main param's value alone", as legacy's toggleable
 *  sampler/scheduler inputs do. */
export function ToggledSelect(props: {
    id: string;
    label: string;
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    value: string;
    options: { value: string; name: string }[];
    onChange: (value: string) => void;
}) {
    return (
        <>
            <input
                type="checkbox"
                aria-label={props.label}
                checked={props.enabled}
                onChange={e => props.onEnabledChange(e.target.checked)}
                className="accent-[var(--emphasis)]"
            />
            <select
                id={props.id}
                value={props.value}
                disabled={!props.enabled}
                onChange={e => props.onChange(e.target.value)}
                className={`${SYNTAX_INPUT_CLASS} min-w-0 flex-1`}
            >
                {props.options.map(option => (
                    <option key={option.value} value={option.value}>
                        {option.name}
                    </option>
                ))}
            </select>
        </>
    );
}
