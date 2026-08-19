import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { parseImageMetadata, type MetadataEntry } from '@/params/metadata';
import { useParamSchema } from '@/params/schema';

/** An image's metadata as a readable list of labelled rows.
 *
 * Same shape as the model detail sheet: a fixed label column, values beside it, technical
 * bookkeeping in its own group at the bottom. The JSON is still one click away for anyone who
 * wants to copy the whole thing back into a tool. */
export function MetadataView(props: { metadata: string | null | undefined; empty: string }) {
    const schema = useParamSchema();
    const parsed = useMemo(() => parseImageMetadata(props.metadata, schema), [props.metadata, schema]);
    const [showRaw, setShowRaw] = useState(false);

    if (!parsed) {
        return <p className="text-sm text-fg-soft">{props.empty}</p>;
    }
    if (parsed.unreadable) {
        return (
            <>
                <p className="mb-2 text-sm text-fg-soft">Metadata isn't in a format this panel can list.</p>
                <RawBlock text={parsed.raw} />
            </>
        );
    }

    return (
        <div>
            {parsed.sections.map(section => (
                <section key={section.title} className="mb-3 last:mb-0">
                    <h3 className="mb-1 text-xs uppercase tracking-wide text-fg-soft">{section.title}</h3>
                    <dl className="space-y-0.5 border-t border-subtle pt-1.5 text-xs">
                        {section.entries.map(entry => (
                            <Row key={entry.id} entry={entry} />
                        ))}
                    </dl>
                </section>
            ))}

            <button
                type="button"
                onClick={() => setShowRaw(o => !o)}
                aria-expanded={showRaw}
                className="mt-1 text-xs text-fg-soft underline decoration-dotted hover:text-fg"
            >
                {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
            </button>
            {showRaw && (
                <div className="mt-2">
                    <RawBlock text={parsed.raw} />
                </div>
            )}
        </div>
    );
}

/** Long values (prompts) get the full width with the label above; everything else is a label/value
 *  pair, because a seed on its own line wastes the panel. */
function Row(props: { entry: MetadataEntry }) {
    const { entry } = props;
    const text = entry.value.join('\n');

    if (entry.long) {
        return (
            <div className="py-1">
                <div className="flex items-baseline gap-1">
                    <dt className="text-fg-soft" title={entry.description}>
                        {entry.label}
                    </dt>
                    <CopyButton text={text} label={entry.label} />
                </div>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-fg">{text}</dd>
            </div>
        );
    }
    return (
        <div className="flex gap-2 py-0.5">
            <dt className="w-[7rem] shrink-0 truncate text-fg-soft" title={entry.description ?? entry.label}>
                {entry.label}
            </dt>
            <dd className="min-w-0 flex-1 break-words text-fg">
                {entry.value.length > 1
                    ? entry.value.map((line, index) => <div key={index}>{line}</div>)
                    : text}
            </dd>
        </div>
    );
}

function RawBlock(props: { text: string }) {
    return (
        <pre className="whitespace-pre-wrap break-words rounded border border-subtle bg-surface-sunken p-2 font-mono text-[11px] text-fg-soft">
            {props.text}
        </pre>
    );
}

function CopyButton(props: { text: string; label: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            aria-label={`Copy ${props.label}`}
            title={`Copy ${props.label}`}
            onClick={() => {
                navigator.clipboard.writeText(props.text).then(
                    () => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    },
                    () => setCopied(false)
                );
            }}
            className="rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
        >
            {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        </button>
    );
}
