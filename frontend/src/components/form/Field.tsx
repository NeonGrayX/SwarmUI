import type { ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Info, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n';

export type FieldDensity = 'comfortable' | 'compact' | 'inline';

export interface FieldProps {
    id: string;
    /** Display text, already translated by the caller — it is as often a server-supplied parameter
     *  name as it is a fixed identifier, so this component cannot resolve it itself. */
    label: string;
    /** Long-form help. Rendered in a tooltip behind the info affordance. */
    description?: string;
    /** Example values, shown under the description. */
    examples?: string[] | null;
    density?: FieldDensity;
    /** Shows the modified dot and enables the reset control. */
    modified?: boolean;
    onReset?: () => void;
    /** Renders a switch beside the label for `toggleable` params. */
    toggle?: { on: boolean; onChange: (on: boolean) => void };
    /** The row is off for a reason its own toggle cannot fix — an unsupported feature flag, or a
     *  group switched off at the block header — so the toggle dims and locks with the rest. */
    toggleBlocked?: boolean;
    /** Greys the row out and blocks input; used for unsupported feature flags. */
    disabled?: boolean;
    disabledReason?: string;
    children: ReactNode;
}

/** The single form row used everywhere in this UI.
 *
 * The layout rule that matters: label and control live in a two-column grid with a *fixed* label
 * column (--sw-field-label-width), so every row in a panel aligns. The legacy UI emits label and
 * control as inline siblings, which is why User Settings and Server Configuration render as ragged
 * text with controls at arbitrary x-positions.
 *
 * The legacy `?` glyph becomes a real info tooltip, so descriptions are readable rather than
 * hover-only tooltips on a 9px character. */
export function Field(props: FieldProps) {
    const { t } = useTranslation();
    const density = props.density ?? 'comfortable';
    const hasHelp = Boolean(props.description || props.examples?.length);
    // The toggle is what switches a row back on, so it never dims with the row it controls — but it
    // does dim when the whole block is off, since flipping it then changes nothing.
    const dim = props.disabled ? 'opacity-45' : '';

    return (
        <div
            className={[
                'group/field grid items-start gap-x-[var(--sw-field-gap)]',
                density === 'comfortable' ? 'py-1.5' : density === 'compact' ? 'py-1' : 'py-0.5'
            ].join(' ')}
            style={{ gridTemplateColumns: 'var(--sw-field-label-width) minmax(0, 1fr)' }}
            title={props.disabled ? props.disabledReason : undefined}
        >
            <div className="flex items-center gap-1 min-w-0 pt-1">
                {props.toggle && (
                    <input
                        type="checkbox"
                        checked={props.toggle.on}
                        onChange={e => props.toggle?.onChange(e.target.checked)}
                        disabled={props.toggleBlocked}
                        aria-label={t('field.enable', { label: props.label })}
                        className={['shrink-0 accent-[var(--emphasis)]', props.toggleBlocked ? dim : ''].join(' ')}
                    />
                )}
                <div className={['flex items-center gap-1 min-w-0', dim].join(' ')}>
                    <label
                        htmlFor={props.id}
                        className="truncate text-sm text-fg-soft group-hover/field:text-fg cursor-default"
                        title={props.label}
                    >
                        {props.label}
                    </label>
                    {hasHelp && <HelpTip label={props.label} description={props.description} examples={props.examples} />}
                    {props.modified && (
                        <span
                            aria-label={t('field.modified')}
                            title={t('field.changedFromDefault')}
                            className="shrink-0 size-1.5 rounded-full"
                            style={{ background: 'var(--sw-modified)' }}
                        />
                    )}
                    {props.modified && props.onReset && (
                        <button
                            type="button"
                            onClick={props.onReset}
                            title={t('field.resetToDefault')}
                            aria-label={t('field.resetLabelToDefault', { label: props.label })}
                            className="shrink-0 rounded p-0.5 text-fg-soft opacity-0 group-hover/field:opacity-100 focus-visible:opacity-100 hover:text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <RotateCcw size={12} aria-hidden />
                        </button>
                    )}
                </div>
            </div>
            <div className={['min-w-0', dim].join(' ')}>{props.children}</div>
        </div>
    );
}

/** Help shown on hover (and on keyboard focus), never needing a click. The content stays hoverable
 * so long descriptions and examples can be read and copied. */
function HelpTip(props: { label: string; description?: string; examples?: string[] | null }) {
    const { t } = useTranslation();
    return (
        <Tooltip.Root>
            <Tooltip.Trigger asChild>
                <button
                    type="button"
                    aria-label={t('field.about', { label: props.label })}
                    onClick={e => e.preventDefault()}
                    className="shrink-0 rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <Info size={12} aria-hidden />
                </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content
                    side="right"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    className="z-50 max-w-xs rounded-lg border border-default bg-surface-raised p-3 shadow-xl"
                >
                    <p className="text-xs font-medium text-fg-strong mb-1">{props.label}</p>
                    {props.description && (
                        <p className="text-xs text-fg-soft whitespace-pre-wrap">{props.description}</p>
                    )}
                    {props.examples && props.examples.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-subtle">
                            <p className="text-[10px] uppercase tracking-wide text-fg-soft mb-1">
                                {t('field.examples')}
                            </p>
                            <ul className="space-y-0.5">
                                {props.examples.slice(0, 6).map(example => (
                                    <li key={example} className="font-mono text-[11px] text-fg break-words">
                                        {example}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <Tooltip.Arrow className="fill-[var(--border-color)]" />
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}
