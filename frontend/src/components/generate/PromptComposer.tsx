import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import { useParamStore } from '@/params/store';
import { useStartGenerate } from '@/generate/start';
import { GenerateActions } from './GenerateActions';
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

/** The prompt block: a full-width band below the canvas rather than an overlay on it. The negative
 *  prompt starts collapsed, since most generations do not use one. */
export function PromptComposer() {
    const { t } = useTranslation();
    const values = useParamStore(s => s.values);
    const setValue = useParamStore(s => s.setValue);
    const [showNegative, setShowNegative] = useState(false);

    const prompt = String(values.prompt ?? '');
    const negative = String(values.negativeprompt ?? '');
    const promptTokens = useTokenCount(prompt);
    const negativeTokens = useTokenCount(negative);

    const promptRef = useRef<HTMLTextAreaElement>(null);
    const doGenerate = useStartGenerate();

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
