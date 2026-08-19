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

const WORD_END = '</w>';

/** Word-end vs word-piece, matching the legacy tokenizer tab's green/yellow split. The colour is
 *  the only way to see where the encoder thinks a word actually ends: "photorealistic" is two
 *  tokens, and only the second one carries the word break. */
const TINT_WORD_END = 'color-mix(in srgb, var(--sw-surface) 70%, var(--green))';
const TINT_WORD_PIECE = 'color-mix(in srgb, var(--sw-surface) 70%, var(--yellow))';

const WEIGHTING_EXAMPLES = [
    'a (cat:1.5) on a mat  →  on: 5 tokens (cat @1.5) / off: 11 tokens',
    '((detailed)) sky  →  on: 2 tokens (detailed @1.21) / off: 4 tokens'
];

const SKIP_EXAMPLES = [
    'a cat <lora:add_detail:0.8>  →  on: 2 tokens / off: 14 tokens',
    'a <random:red|bright blue> car  →  on: 4 tokens / off: 10 tokens',
    'a cat <segment:face> a face  →  on: 2 tokens / off: 11 tokens'
];

export function TokenizerPage() {
    const [text, setText] = useState('a photorealistic portrait of a tabby cat');
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
            title="CLIP Tokenization"
            summary="See exactly how a text encoder splits your prompt into tokens."
            about={
                <>
                    <p>
                        Text encoders don't read words, they read tokens. A prompt that looks short
                        can use more tokens than expected, and anything past a chunk boundary is
                        processed separately. Every current Stable Diffusion model shares this same
                        CLIP token set, so the result applies to all of them.
                    </p>
                    <p>
                        Each block shows the text-piece and, below it, its numeric token ID — the
                        actual value handed to the encoder. Green blocks end a word (the encoder's{' '}
                        <code className="font-mono">{WORD_END}</code> marker, meaning a space or
                        punctuation follows); yellow blocks are word-pieces that run straight into
                        the next block.
                    </p>
                    <p>
                        Token IDs are useful for spotting when a word you thought was one concept is
                        really several unrelated pieces, and for matching a token against embedding
                        or vocabulary tooling that works in IDs rather than text.
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

            <Field
                id="tok-weight"
                label="Parse weighting"
                density="compact"
                description="On, (word:1.5) syntax is read as a weight: the parentheses and the number vanish from the token stream and the word carries the weight instead. Off, every one of those characters is tokenized as literal text, which is what a model without weighting support would see."
                examples={WEIGHTING_EXAMPLES}
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
                label="Strip prompt syntax"
                density="compact"
                description="On, SwarmUI's own <...> prompt syntax is resolved before tokenizing: <lora:>, <embed:> and similar drop out entirely, <random:> and <wildcard:> collapse to their longest option, and everything from <segment:>, <object:>, <region:>, <clear:> or <extend:> onward is cut, since those are separate passes. Off, all of it is tokenized as plain text. Turn this on to see the count your model will actually receive."
                examples={SKIP_EXAMPLES}
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
                    <span className="text-fg-strong tabular-nums">{list.length} tokens</span>
                    <span className="text-fg-soft">
                        {chunks} chunk{chunks === 1 ? '' : 's'} of 75
                    </span>
                    {tokens.isFetching && <span className="text-xs text-fg-soft">updating…</span>}
                    <div className="flex-1" />
                    <Legend tint={TINT_WORD_END} label="word end" />
                    <Legend tint={TINT_WORD_PIECE} label="word piece" />
                </div>

                {tokens.isError ? (
                    <p className="text-sm" style={{ color: 'var(--backend-errored)' }}>
                        {tokens.error instanceof Error ? tokens.error.message : 'Tokenization failed.'}
                    </p>
                ) : list.length === 0 ? (
                    <p className="text-sm text-fg-soft">Type something above to tokenize it.</p>
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
    const { token } = props;
    const isWordEnd = token.text.endsWith(WORD_END);
    const weight = Math.round(token.weight * 100) / 100;

    return (
        <span
            title={
                isWordEnd
                    ? 'Ends a word — a word break (space or punctuation) follows this token.'
                    : 'Word-piece — no word break after it, it connects directly to the next token.'
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
