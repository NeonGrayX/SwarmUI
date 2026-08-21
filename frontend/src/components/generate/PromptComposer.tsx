import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Square } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { api } from '@/api/client';
import { useParamStore } from '@/params/store';
import { useGenerateStore } from '@/generate/store';
import { useStartGenerate } from '@/generate/start';
import type { GenIssue } from '@/generate/validate';
import { MODEL_SELECT_ID } from './ContextStrip';
import { PromptAttachments } from './PromptAttachments';
import { useTranslation } from '@/i18n';

/** Debounced CLIP token count for a prompt box, via the CountTokens API. */
function useTokenCount(text: string): number | null {
    const [count, setCount] = useState<number | null>(null);
    useEffect(() => {
        if (!text.trim()) {
            setCount(0);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            api
                .post<{ count: number }>('CountTokens', { text, skipPromptSyntax: true })
                .then(data => {
                    if (!cancelled) {
                        setCount(data.count);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setCount(null);
                    }
                });
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [text]);
    return count;
}

/** The prompt block.
 *
 * Sits below the canvas as a full-width block rather than floating over the image the way
 * .alt_prompt_region does in the legacy UI, where the token counter, attach button, Generate,
 * a caret and an interrupt X all share one cramped line. The negative prompt starts collapsed
 * because most generations do not use one. */
export function PromptComposer() {
    const { t } = useTranslation();
    const values = useParamStore(s => s.values);
    const setValue = useParamStore(s => s.setValue);
    const [showNegative, setShowNegative] = useState(false);

    const prompt = String(values.prompt ?? '');
    const negative = String(values.negativeprompt ?? '');
    const promptTokens = useTokenCount(prompt);
    const negativeTokens = useTokenCount(negative);

    const running = useGenerateStore(s => s.running);
    const forever = useGenerateStore(s => s.forever);
    const interrupt = useGenerateStore(s => s.interrupt);
    const inputError = useGenerateStore(s => s.inputError);
    const clearInputError = useGenerateStore(s => s.clearInputError);

    const promptRef = useRef<HTMLTextAreaElement>(null);
    const doGenerate = useStartGenerate();

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
        <div className="border-t border-subtle bg-surface p-3 space-y-2">
            <PromptBox
                ref={promptRef}
                id="prompt"
                label={t('generate.prompt.label')}
                value={prompt}
                tokens={promptTokens}
                placeholder={t('generate.prompt.placeholder')}
                onChange={v => setValue('prompt', v)}
                onSubmit={doGenerate}
            />

            <div>
                <button
                    type="button"
                    onClick={() => setShowNegative(o => !o)}
                    aria-expanded={showNegative}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    {showNegative ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                    {t('generate.negativePrompt.label')}
                    {!showNegative && negative.trim() && (
                        <span className="rounded-full px-1.5 text-[10px]" style={{ background: 'var(--sw-chip-bg)' }}>
                            {t('generate.negativePrompt.set')}
                        </span>
                    )}
                </button>
                {showNegative && (
                    <div className="mt-1">
                        <PromptBox
                            id="negativeprompt"
                            label={t('generate.negativePrompt.label')}
                            value={negative}
                            tokens={negativeTokens}
                            placeholder={t('generate.negativePrompt.placeholder')}
                            onChange={v => setValue('negativeprompt', v)}
                            onSubmit={doGenerate}
                        />
                    </div>
                )}
            </div>

            {inputError && <InputErrorNotice issue={inputError} />}

            <div className="flex items-end gap-2">
                <PromptAttachments />
                <div className="flex-1" />
                {running && (
                    <button
                        type="button"
                        onClick={() => interrupt(false)}
                        className="flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm"
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
                <GenerateSplitButton running={running} forever={forever} onGenerate={doGenerate} />
            </div>
        </div>
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
                    onClick={() => document.getElementById(MODEL_SELECT_ID)?.focus()}
                    className="rounded border border-default px-2 py-0.5 text-xs hover:bg-[var(--sw-hover)]"
                >
                    {t('generate.chooseModel')}
                </button>
            )}
        </div>
    );
}

/** Primary action plus a menu, replacing the legacy trio of Generate / bare caret / bare X. */
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
                className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium disabled:opacity-60"
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
                        className="px-1.5 border-l"
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

function PromptBox(props: {
    ref?: React.Ref<HTMLTextAreaElement>;
    id: string;
    label: string;
    value: string;
    tokens: number | null;
    placeholder: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <textarea
                ref={props.ref}
                id={`composer-${props.id}`}
                aria-label={props.label}
                rows={2}
                value={props.value}
                placeholder={props.placeholder}
                onChange={e => props.onChange(e.target.value)}
                onKeyDown={e => {
                    // Ctrl/Cmd-Enter generates; plain Enter inserts a newline.
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        props.onSubmit();
                    }
                }}
                className="w-full resize-y rounded border border-default bg-surface-sunken px-2 py-1.5 pr-16 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
            />
            {props.tokens !== null && (
                <span
                    title={t('generate.tokenCountHint')}
                    className="pointer-events-none absolute right-2 top-1.5 text-[10px] tabular-nums text-fg-soft"
                >
                    {t('generate.tokenCount', { count: props.tokens, chunk: 75 })}
                </span>
            )}
        </div>
    );
}
