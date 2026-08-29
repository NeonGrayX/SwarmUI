import * as Popover from '@radix-ui/react-popover';
import { Pipette } from 'lucide-react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { hexToLevel, levelToHex } from '@/editor/color';
import { useTranslation } from '@/i18n';

/** The colour control in the editor's option bar: a react-colorful swatch picker, plus an
 *  eyedropper.
 *
 *  On a mask layer the hue/saturation area is replaced by a single brightness ramp: a mask carries
 *  nothing but brightness, so offering colours there would invite a choice that is silently
 *  discarded on the way to the backend. */
export function ColorField(props: {
    value: string;
    grayscale: boolean;
    /** True while the eyedropper is armed. */
    picking: boolean;
    onChange: (color: string) => void;
    onPick: () => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="flex items-center gap-1.5">
            <span className="text-xs text-fg-soft">{t('editor.option.color')}</span>
            <Popover.Root>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={t('editor.option.openColorPicker')}
                        className="flex items-center gap-1.5 rounded border border-default bg-surface-sunken py-0.5 pl-1 pr-1.5 hover:bg-[var(--sw-hover)]"
                    >
                        <span
                            aria-hidden
                            className="h-4 w-4 shrink-0 rounded-sm border border-default"
                            style={{ background: props.value }}
                        />
                        <span className="font-mono text-xs uppercase text-fg">{props.value}</span>
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        side="top"
                        align="start"
                        sideOffset={6}
                        className="z-50 rounded-lg border border-default bg-surface-raised p-2 shadow-xl"
                    >
                        {props.grayscale ? (
                            <label className="flex w-52 flex-col gap-1 text-xs text-fg-soft">
                                {t('editor.option.brightness')}
                                <input
                                    type="range"
                                    min={0}
                                    max={255}
                                    step={1}
                                    value={hexToLevel(props.value)}
                                    onChange={e => props.onChange(levelToHex(Number(e.target.value)))}
                                    className="w-full accent-[var(--emphasis)]"
                                    style={{
                                        background: 'linear-gradient(to right, #000000, #ffffff)'
                                    }}
                                />
                            </label>
                        ) : (
                            <HexColorPicker color={props.value} onChange={props.onChange} />
                        )}
                        <HexColorInput
                            color={props.value}
                            onChange={props.onChange}
                            prefixed
                            aria-label={t('editor.option.hexValue')}
                            className="mt-2 w-full rounded border border-default bg-surface-sunken px-2 py-1 text-center font-mono text-sm uppercase text-fg outline-none focus:border-[var(--emphasis)]"
                        />
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
            <button
                type="button"
                onClick={props.onPick}
                aria-pressed={props.picking}
                title={t('editor.option.eyedropper')}
                aria-label={t('editor.option.eyedropper')}
                className="rounded border border-default p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                style={
                    props.picking
                        ? { background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }
                        : undefined
                }
            >
                <Pipette size={13} aria-hidden />
            </button>
        </div>
    );
}
