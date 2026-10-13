import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import { useParamStore } from '@/params/store';
import { useStartGenerate } from '@/generate/start';
import { GenerateActions } from './GenerateActions';
import { PromptAttachments } from './PromptAttachments';
import { openPromptSuggestions, PromptTextarea } from '@/components/form/PromptTextarea';
import { useTranslation } from '@/i18n';
import { useUserSetting } from '@/settings/useUserSetting';
import { PromptToolsMenu } from './prompt/PromptToolsMenu';
import { dragHasMedia, droppedMediaUrl, usePromptImageAttach } from './prompt/promptImages';

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

/** Whether a key press asks the prompt box to generate: Ctrl/Cmd+Enter always, and plain Enter when
 *  the user's EnterKeyGenerates setting is on (Shift+Enter then still inserts a newline), as the
 *  legacy prompt box does (src/wwwroot/js/genpage/gentab/layout.js:1154). */
function isGenerateKey(e: React.KeyboardEvent, enterGenerates: boolean): boolean {
    if (e.key !== 'Enter') {
        return false;
    }
    if (e.ctrlKey || e.metaKey) {
        return true;
    }
    return enterGenerates && !e.shiftKey && !e.altKey;
}

/** The prompt block: a full-width band below the canvas rather than an overlay on it. The negative
 *  prompt starts collapsed, since most generations do not use one.
 *
 *  Images pasted into the prompt, or dropped anywhere on the block (files, or images dragged out of
 *  the batch/canvas), attach as prompt images, as the legacy prompt region does
 *  (src/wwwroot/js/genpage/main.js:730, :783). */
export function PromptComposer() {
    const { t } = useTranslation();
    // Scalar selectors, so dragging a slider elsewhere in the param panel does not re-render this.
    const prompt = useParamStore(s => String(s.values.prompt ?? ''));
    const negative = useParamStore(s => String(s.values.negativeprompt ?? ''));
    const setValue = useParamStore(s => s.setValue);
    const [showNegative, setShowNegative] = useState(false);
    const enterSetting = useUserSetting<unknown>('enterkeygenerates', true);
    const enterGenerates = enterSetting === true || enterSetting === 'true';

    const promptTokens = useTokenCount(prompt);
    const negativeTokens = useTokenCount(negative);

    const promptRef = useRef<HTMLTextAreaElement>(null);
    const doGenerate = useStartGenerate();
    const attach = usePromptImageAttach();
    const [dragging, setDragging] = useState(false);
    const [attachError, setAttachError] = useState<string | null>(null);

    /** Writes the prompt, then puts the caret at its end once the box shows the new text. */
    const writePrompt = (text: string, then?: (box: HTMLTextAreaElement) => void) => {
        setValue('prompt', text);
        requestAnimationFrame(() => {
            const box = promptRef.current;
            if (!box) {
                return;
            }
            box.focus();
            box.setSelectionRange(box.value.length, box.value.length);
            then?.(box);
        });
    };

    /** Appends syntax on a line of its own. Ported from applyNewSyntax (prompttools.js:855). */
    const insertSyntax = (syntax: string) => {
        const current = String(useParamStore.getState().values.prompt ?? '');
        writePrompt(`${current.trim()}\n${syntax.trim()}`.trim());
    };

    /** Starts a new `<` and lists the syntax tags, as the legacy "Other..." menu entry does. */
    const otherSyntax = () => {
        const current = String(useParamStore.getState().values.prompt ?? '').trim();
        const text = current.endsWith('<') ? current : current ? `${current} <` : '<';
        writePrompt(text, openPromptSuggestions);
    };

    const report = (e: unknown) => setAttachError(e instanceof Error ? e.message : t('media.readFailed'));

    const onPaste = (e: React.ClipboardEvent) => {
        const files = [...(e.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'));
        if (files.length > 0) {
            setAttachError(null);
            attach.addFiles(files).catch(report);
        }
    };

    const onDrop = (e: React.DragEvent) => {
        setDragging(false);
        // A drop on the attachment field itself has already been taken by that field.
        if (e.defaultPrevented) {
            return;
        }
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            e.preventDefault();
            setAttachError(null);
            attach.addFiles(files).catch(report);
            return;
        }
        const url = droppedMediaUrl(e.dataTransfer);
        if (url) {
            e.preventDefault();
            setAttachError(null);
            attach.addUrl(url).catch(report);
        }
        else if (!(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
            // A plain link dropped beside the boxes would otherwise navigate away from the page.
            e.preventDefault();
        }
    };

    return (
        <div
            onDragOver={
                attach.available
                    ? e => {
                        if (dragHasMedia(e.dataTransfer)) {
                            e.preventDefault();
                            setDragging(true);
                        }
                    }
                    : undefined
            }
            onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDragging(false);
                }
            }}
            onDrop={attach.available ? onDrop : undefined}
            className={[
                'border-t border-subtle bg-surface p-3 space-y-2 transition-shadow',
                dragging ? 'shadow-[inset_0_0_0_2px_var(--emphasis)]' : ''
            ].join(' ')}
        >
            <div className="flex items-start gap-2">
                <PromptToolsMenu onInsert={insertSyntax} onOtherSyntax={otherSyntax} />
                <div className="min-w-0 flex-1">
                    <PromptBox
                        ref={promptRef}
                        id="prompt"
                        label={t('generate.prompt.label')}
                        value={prompt}
                        tokens={promptTokens}
                        placeholder={t('generate.prompt.placeholder')}
                        enterGenerates={enterGenerates}
                        onChange={v => setValue('prompt', v)}
                        onSubmit={doGenerate}
                        onPaste={attach.available ? onPaste : undefined}
                    />
                </div>
            </div>
            {attachError && (
                <p role="alert" className="text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {attachError}
                </p>
            )}

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
                            enterGenerates={enterGenerates}
                            onChange={v => setValue('negativeprompt', v)}
                            onSubmit={doGenerate}
                        />
                    </div>
                )}
            </div>

            <GenerateActions onGenerate={doGenerate} leading={<PromptAttachments />} />
        </div>
    );
}

function PromptBox(props: {
    ref?: React.Ref<HTMLTextAreaElement>;
    id: string;
    label: string;
    value: string;
    tokens: number | null;
    placeholder: string;
    enterGenerates: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <PromptTextarea
                ref={props.ref}
                id={`composer-${props.id}`}
                aria-label={props.label}
                rows={2}
                value={props.value}
                placeholder={props.placeholder}
                onValueChange={props.onChange}
                onPaste={props.onPaste}
                onKeyDown={e => {
                    if (isGenerateKey(e, props.enterGenerates)) {
                        e.preventDefault();
                        // Runs queue now, so a held key would otherwise start one per repeat.
                        if (!e.repeat) {
                            props.onSubmit();
                        }
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
