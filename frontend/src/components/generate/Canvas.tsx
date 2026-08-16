import { useMemo, useState } from 'react';
import { ImageIcon, Info } from 'lucide-react';
import { imageUrl, useGenerateStore } from '@/generate/store';

/** The main image view, plus a collapsible metadata panel. */
export function Canvas() {
    const batch = useGenerateStore(s => s.batch);
    const selected = useGenerateStore(s => s.selected);
    const error = useGenerateStore(s => s.error);
    const [showMetadata, setShowMetadata] = useState(false);

    const current = batch.find(item => item.batchIndex === selected);
    const src = imageUrl(current?.src);

    const metadata = useMemo(() => {
        if (!current?.metadata) {
            return null;
        }
        try {
            return JSON.stringify(JSON.parse(current.metadata), null, 2);
        }
        catch {
            // The API explicitly does not guarantee JSON here; show it raw when it isn't.
            return current.metadata;
        }
    }, [current?.metadata]);

    return (
        <div className="flex flex-1 min-h-0 min-w-0">
            <div className="relative flex flex-1 min-w-0 items-center justify-center overflow-auto p-4">
                {error && (
                    <div
                        className="absolute inset-x-4 top-4 rounded border p-3 text-sm"
                        style={{
                            borderColor: 'color-mix(in srgb, var(--backend-errored) 40%, transparent)',
                            background: 'color-mix(in srgb, var(--backend-errored) 12%, transparent)'
                        }}
                    >
                        {error}
                    </div>
                )}

                {src ? (
                    <img
                        src={src}
                        alt={current?.isPreview ? 'Generation preview' : 'Generated image'}
                        className="max-h-full max-w-full object-contain"
                        style={current?.isPreview ? { filter: 'saturate(0.9)' } : undefined}
                    />
                ) : (
                    <div className="text-center text-fg-soft">
                        <ImageIcon size={40} className="mx-auto mb-3 opacity-40" aria-hidden />
                        <p>No image yet.</p>
                        <p className="mt-1 text-sm">Write a prompt below and hit Generate.</p>
                    </div>
                )}

                {current && (
                    <button
                        type="button"
                        onClick={() => setShowMetadata(o => !o)}
                        aria-pressed={showMetadata}
                        title="Image metadata"
                        className="absolute right-3 top-3 rounded border border-default bg-surface p-1.5 text-fg-soft hover:text-fg"
                    >
                        <Info size={15} aria-hidden />
                    </button>
                )}
            </div>

            {showMetadata && current && (
                <aside className="w-72 shrink-0 overflow-auto border-l border-subtle bg-surface p-3">
                    <h2 className="mb-2 text-sm font-medium text-fg-strong">Metadata</h2>
                    {metadata ? (
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-fg-soft">
                            {metadata}
                        </pre>
                    ) : (
                        <p className="text-sm text-fg-soft">No metadata for this image.</p>
                    )}
                </aside>
            )}
        </div>
    );
}
