import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';

interface Token {
    id: number;
    weight: number;
    text: string;
}

const TOKEN_SETS = ['clip', 't5', 'llama3', 'llama4'];

/** Colours cycle so adjacent tokens are visually separable. */
const TOKEN_TINTS = [
    'color-mix(in srgb, var(--emphasis) 30%, transparent)',
    'color-mix(in srgb, var(--backend-running) 25%, transparent)',
    'color-mix(in srgb, var(--status-bar-warn-color-middle) 30%, transparent)',
    'color-mix(in srgb, var(--emphasis-soft) 45%, transparent)'
];

export function TokenizerPage() {
    const [text, setText] = useState('a photorealistic portrait of a tabby cat');
    const [tokenset, setTokenset] = useState('clip');
    const [weighting, setWeighting] = useState(true);
    const [skipPromptSyntax, setSkipPromptSyntax] = useState(false);

    const tokens = useQuery({
        queryKey: ['tokenize', text, tokenset, weighting, skipPromptSyntax],
        queryFn: () =>
            api.post<{ tokens: Token[] }>('TokenizeInDetail', {
                text,
                tokenset,
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
            title="CLIP Tokenization"
            summary="See exactly how a text encoder splits your prompt into tokens."
            about={
                <>
                    <p>
                        Text encoders don't read words, they read tokens. A prompt that looks short
                        can use more tokens than expected, and anything past a chunk boundary is
                        processed separately.
                    </p>
                    <p>
                        Weighting parses syntax like <code className="font-mono">(word:1.5)</code>.
                        Turning it off treats those characters as literal text.
                    </p>
                </>
            }
        >
            <Field id="tok-text" label="Text" density="compact">
                <textarea
                    id="tok-text"
                    rows={3}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    className="w-full resize-y rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />
            </Field>

            <Field id="tok-set" label="Token set" density="compact">
                <select
                    id="tok-set"
                    value={tokenset}
                    onChange={e => setTokenset(e.target.value)}
                    className="rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                >
                    {TOKEN_SETS.map(set => (
                        <option key={set} value={set}>
                            {set}
                        </option>
                    ))}
                </select>
            </Field>

            <Field id="tok-weight" label="Parse weighting" density="compact">
                <input
                    id="tok-weight"
                    type="checkbox"
                    checked={weighting}
                    onChange={e => setWeighting(e.target.checked)}
                    className="accent-[var(--emphasis)]"
                />
            </Field>

            <Field id="tok-skip" label="Strip prompt syntax" density="compact">
                <input
                    id="tok-skip"
                    type="checkbox"
                    checked={skipPromptSyntax}
                    onChange={e => setSkipPromptSyntax(e.target.checked)}
                    className="accent-[var(--emphasis)]"
                />
            </Field>

            <div className="mt-3 border-t border-subtle pt-3">
                <div className="mb-2 flex items-baseline gap-3 text-sm">
                    <span className="text-fg-strong tabular-nums">{list.length} tokens</span>
                    <span className="text-fg-soft">
                        {chunks} chunk{chunks === 1 ? '' : 's'} of 75
                    </span>
                    {tokens.isFetching && <span className="text-xs text-fg-soft">updating…</span>}
                </div>

                {tokens.isError ? (
                    <p className="text-sm" style={{ color: 'var(--backend-errored)' }}>
                        {tokens.error instanceof Error ? tokens.error.message : 'Tokenization failed.'}
                    </p>
                ) : list.length === 0 ? (
                    <p className="text-sm text-fg-soft">Type something above to tokenize it.</p>
                ) : (
                    <div className="flex flex-wrap gap-0.5">
                        {list.map((token, i) => (
                            <span
                                key={`${token.id}-${i}`}
                                title={`id ${token.id}${token.weight !== 1 ? ` · weight ${token.weight}` : ''}`}
                                className="rounded px-1 py-0.5 font-mono text-xs text-fg"
                                style={{ background: TOKEN_TINTS[i % TOKEN_TINTS.length] }}
                            >
                                {token.text.replace(/<\/w>$/, '')}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </ToolLayout>
    );
}
