import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { t as translate, useTranslation } from '@/i18n';

interface Token {
    id: number;
    weight: number;
    text: string;
}

const WORD_END = '</w>';

/** Word-end vs word-piece. The colour is the only way to see where the encoder thinks a word
 *  actually ends: "photorealistic" is two tokens, and only the second carries the word break. */
const TINT_WORD_END = 'color-mix(in srgb, var(--sw-surface) 70%, var(--green))';
const TINT_WORD_PIECE = 'color-mix(in srgb, var(--sw-surface) 70%, var(--yellow))';

/** Worked examples for the two toggles. The prompts themselves are literal input text, so only
 *  the "on/off" commentary around them is translated. */
const WEIGHTING_EXAMPLES = ['tokenizer.example.weighting1', 'tokenizer.example.weighting2'];

const SKIP_EXAMPLES = [
    'tokenizer.example.skip1',
    'tokenizer.example.skip2',
    'tokenizer.example.skip3'
];

export function TokenizerPage() {
    const { t } = useTranslation();
    const [text, setText] = useState(translate('tokenizer.defaultText'));
    const [weighting, setWeighting] = useState(true);
    const [skipPromptSyntax, setSkipPromptSyntax] = useState(false);

    const tokens = useQuery({
        queryKey: ['tokenize', text, weighting, skipPromptSyntax],
        queryFn: () =>
            api.post<{ tokens: Token[] }>('TokenizeInDetail', {
                text,
                weighting,
                skipPromptSyntax
            }),
        enabled: text.trim().length > 0
    });

    const list = useMemo(() => tokens.data?.tokens ?? [], [tokens.data]);
    // CLIP-family encoders work in chunks of 75 tokens; going over means an extra chunk.
    const chunks = Math.max(1, Math.ceil(list.length / 75));

    return (
        <ToolLayout
            title={t('nav.destination.tokenizer')}
            summary={t('tokenizer.summary')}
            about={
                <>
                    <p>{t('tokenizer.about1')}</p>
                    <p>
                        {t('tokenizer.about2a')} <code className="font-mono">{WORD_END}</code>{' '}
                        {t('tokenizer.about2b')}
                    </p>
                    <p>{t('tokenizer.about3')}</p>
                </>
            }
        >
            <Field id="tok-text" label={t('tokenizer.text')} density="compact">
                <textarea
                    id="tok-text"
                    rows={3}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    className="w-full resize-y rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />
            </Field>

            <Field
                id="tok-weight"
                label={t('tokenizer.parseWeighting')}
                density="compact"
                description={t('tokenizer.parseWeightingHelp')}
                examples={WEIGHTING_EXAMPLES.map(key => t(key))}
            >
                <input
                    id="tok-weight"
                    type="checkbox"
                    checked={weighting}
                    onChange={e => setWeighting(e.target.checked)}
                    className="accent-[var(--emphasis)]"
                />
            </Field>

            <Field
                id="tok-skip"
                label={t('tokenizer.stripSyntax')}
                density="compact"
                description={t('tokenizer.stripSyntaxHelp')}
                examples={SKIP_EXAMPLES.map(key => t(key))}
            >
                <input
                    id="tok-skip"
                    type="checkbox"
                    checked={skipPromptSyntax}
                    onChange={e => setSkipPromptSyntax(e.target.checked)}
                    className="accent-[var(--emphasis)]"
                />
            </Field>

            <div className="mt-3 border-t border-subtle pt-3">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <span className="text-fg-strong tabular-nums">
                        {t('tokenizer.tokenCount', { count: list.length })}
                    </span>
                    <span className="text-fg-soft">
                        {t('tokenizer.chunkCount', { count: chunks, size: 75 })}
                    </span>
                    {tokens.isFetching && (
                        <span className="text-xs text-fg-soft">{t('tokenizer.updating')}</span>
                    )}
                    <div className="flex-1" />
                    <Legend tint={TINT_WORD_END} label={t('tokenizer.wordEnd')} />
                    <Legend tint={TINT_WORD_PIECE} label={t('tokenizer.wordPiece')} />
                </div>

                {tokens.isError ? (
                    <p className="text-sm" style={{ color: 'var(--backend-errored)' }}>
                        {tokens.error instanceof Error ? tokens.error.message : t('tokenizer.failed')}
                    </p>
                ) : list.length === 0 ? (
                    <p className="text-sm text-fg-soft">{t('tokenizer.typeSomething')}</p>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {list.map((token, i) => (
                            <TokenBlock key={`${token.id}-${i}`} token={token} />
                        ))}
                    </div>
                )}
            </div>
        </ToolLayout>
    );
}

function TokenBlock(props: { token: Token }) {
    const { t } = useTranslation();
    const { token } = props;
    const isWordEnd = token.text.endsWith(WORD_END);
    const weight = Math.round(token.weight * 100) / 100;

    return (
        <span
            title={
                isWordEnd ? t('tokenizer.wordEndHint') : t('tokenizer.wordPieceHint')
            }
            className="rounded-lg px-1.5 py-0.5 text-center font-mono text-xs leading-tight text-fg"
            style={{ background: isWordEnd ? TINT_WORD_END : TINT_WORD_PIECE }}
        >
            {isWordEnd ? token.text.slice(0, -WORD_END.length) : token.text}
            {isWordEnd && <span className="text-[80%] text-fg-soft">&lt;/w&gt;</span>}
            <span className="block text-[85%] tabular-nums text-fg-soft">
                {token.id}
                {weight !== 1 && <span className="ml-1 text-[85%]">×{weight}</span>}
            </span>
        </span>
    );
}

function Legend(props: { tint: string; label: string }) {
    return (
        <span className="flex items-center gap-1 text-xs text-fg-soft">
            <span className="size-2.5 rounded-sm" style={{ background: props.tint }} aria-hidden />
            {props.label}
        </span>
    );
}
