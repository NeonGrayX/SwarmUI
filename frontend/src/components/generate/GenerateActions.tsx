import { useEffect } from 'react';
import { AlertTriangle, ChevronDown, Loader2, Square } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useParamStore } from '@/params/store';
import { useGenerateStore } from '@/generate/store';
import type { GenIssue } from '@/generate/validate';
import { MODEL_SELECT_ID } from '@/components/form/controls';
import { useTranslation } from '@/i18n';

/** Asks the workspace to bring the parameter panel into view. Only the narrow layout, where the
 *  panes are tabs, has anything to do about it — in the split layout the panel is always up. */
export const SHOW_PARAMS_EVENT = 'sw:show-params';

/** The row every workspace ends with: why the last press did not send, and the buttons that send.
 *
 * Shared rather than duplicated because "how a run is started and stopped" is the same question
 * whichever workspace is asking it - the standard one asks it under a prompt box, the Simple one
 * under a workflow's own controls.
 */
export function GenerateActions(props: {
    onGenerate: () => void;
    /** Placed at the far end of the row, before the buttons. */
    leading?: React.ReactNode;
}) {
    const { t } = useTranslation();
    const running = useGenerateStore(s => s.running);
    const forever = useGenerateStore(s => s.forever);
    const interrupt = useGenerateStore(s => s.interrupt);
    const inputError = useGenerateStore(s => s.inputError);
    const clearInputError = useGenerateStore(s => s.clearInputError);

    // Drop the notice as soon as the user touches the param it complained about, so it never
    // lingers over an input that has already been fixed.
    useEffect(() => {
        const paramId = inputError?.paramId;
        if (!paramId) {
            return;
        }
        const before = useParamStore.getState().values[paramId];
        return useParamStore.subscribe(state => {
            if (state.values[paramId] !== before) {
                clearInputError();
            }
        });
    }, [inputError, clearInputError]);

    return (
        <>
            {inputError && <InputErrorNotice issue={inputError} />}

            {/* Wraps rather than compresses: on a phone the leading control takes its own row
                and the actions drop below it, still right-aligned and still thumb-height. */}
            <div className="flex flex-wrap items-end justify-end gap-2">
                {props.leading && <div className="mr-auto w-full sm:w-auto">{props.leading}</div>}
                {running && (
                    <button
                        type="button"
                        onClick={() => interrupt(false)}
                        className="flex items-center gap-1.5 rounded border px-2.5 py-2 text-sm sm:py-1.5"
                        style={{
                            borderColor: 'var(--danger-button-border)',
                            background: 'var(--danger-button-background)',
                            color: 'var(--danger-button-foreground)'
                        }}
                    >
                        <Square size={13} aria-hidden />
                        {t('generate.interrupt')}
                    </button>
                )}
                <GenerateSplitButton running={running} forever={forever} onGenerate={props.onGenerate} />
            </div>
        </>
    );
}

/** Why the last Generate press did not send anything.
 *
 * Sits by the button that was pressed rather than in the canvas banner (which is for errors the
 * server reported), since the fix is always in the controls around it. */
function InputErrorNotice(props: { issue: GenIssue }) {
    const { t } = useTranslation();
    return (
        <div
            role="alert"
            className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-sm text-fg"
            style={{
                borderColor: 'var(--sw-error-border)',
                background: 'var(--sw-error-tint)'
            }}
        >
            <AlertTriangle size={14} className="shrink-0" aria-hidden />
            <span className="flex-1">{props.issue.message}</span>
            {props.issue.paramId === 'model' && (
                <button
                    type="button"
                    onClick={() => {
                        // The picker lives in the parameter panel, which on a narrow screen is a
                        // tab that may not be the one showing - so ask for it first, then reach for
                        // the control once that tab has rendered.
                        document.dispatchEvent(new CustomEvent(SHOW_PARAMS_EVENT));
                        requestAnimationFrame(() => {
                            const picker = document.getElementById(MODEL_SELECT_ID);
                            picker?.scrollIntoView({ block: 'center' });
                            picker?.focus();
                        });
                    }}
                    className="rounded border border-default px-2 py-0.5 text-xs hover:bg-[var(--sw-hover)]"
                >
                    {t('generate.chooseModel')}
                </button>
            )}
        </div>
    );
}

/** Generate, plus a menu holding the run variants and the interrupt actions. */
function GenerateSplitButton(props: { running: boolean; forever: boolean; onGenerate: () => void }) {
    const { t } = useTranslation();
    const setForever = useGenerateStore(s => s.setForever);
    const clearBatch = useGenerateStore(s => s.clearBatch);
    const interrupt = useGenerateStore(s => s.interrupt);

    return (
        <div className="flex items-stretch rounded overflow-hidden">
            <button
                type="button"
                onClick={props.onGenerate}
                disabled={props.running}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-60 sm:py-1.5"
                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
            >
                {props.running && <Loader2 size={14} className="animate-spin" aria-hidden />}
                {props.running ? t('generate.generating') : t('generate.generate')}
            </button>
            <Popover.Root>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={t('generate.moreOptions')}
                        className="px-2.5 border-l sm:px-1.5"
                        style={{
                            background: 'var(--emphasis)',
                            color: 'var(--sw-accent-fg)',
                            borderColor: 'color-mix(in srgb, black 20%, transparent)'
                        }}
                    >
                        <ChevronDown size={14} aria-hidden />
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        side="top"
                        align="end"
                        sideOffset={6}
                        className="z-50 min-w-52 rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                    >
                        <MenuItem
                            label={
                                props.forever
                                    ? t('generate.menu.stopForever')
                                    : t('generate.menu.generateForever')
                            }
                            onClick={() => setForever(!props.forever)}
                        />
                        <MenuItem label={t('generate.menu.interruptSession')} onClick={() => interrupt(false)} />
                        <MenuItem label={t('generate.menu.interruptAll')} onClick={() => interrupt(true)} />
                        <MenuItem label={t('generate.menu.clearBatch')} onClick={clearBatch} />
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    );
}

function MenuItem(props: { label: string; onClick: () => void }) {
    return (
        <Popover.Close asChild>
            <button
                type="button"
                onClick={props.onClick}
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-fg hover:bg-[var(--sw-hover)]"
            >
                {props.label}
            </button>
        </Popover.Close>
    );
}
