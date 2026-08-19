import { useEffect, useState } from 'react';
import { ImageIcon, Info } from 'lucide-react';
import { imageUrl, useGenerateStore } from '@/generate/store';
import { useMediaParamAction } from '@/params/useMediaParamAction';
import { MetadataView } from '../ui/MetadataView';

/** The main image view, plus a collapsible metadata panel. */
export function Canvas() {
    const batch = useGenerateStore(s => s.batch);
    const selected = useGenerateStore(s => s.selected);
    const error = useGenerateStore(s => s.error);
    const [showMetadata, setShowMetadata] = useState(false);
    const [reuse, setReuse] = useState<string | null>(null);
    const mediaParam = useMediaParamAction();

    const current = batch.find(item => item.id === selected);
    const src = imageUrl(current?.src);
    // Previews are half-finished renders; feeding one back in as an input is never what was meant.
    const canReuse = Boolean(src) && !current?.isPreview;

    /** Sends the shown image to a media param, inlining it so the param survives a page reload. */
    function sendTo(paramId: string, label: string) {
        if (!src) {
            return;
        }
        setReuse(null);
        mediaParam
            .set(paramId, src)
            .then(() => setReuse(`Sent to ${label}.`))
            .catch((e: unknown) => setReuse(e instanceof Error ? e.message : `Could not set ${label}.`));
    }

    // The confirmation is a nicety, not a state the user has to dismiss.
    useEffect(() => {
        if (reuse) {
            const timer = setTimeout(() => setReuse(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [reuse]);

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
                    <div className="absolute right-3 top-3 flex items-center gap-1.5">
                        {canReuse && mediaParam.available('initimage') && (
                            <ReuseButton label="Use as init image" onClick={() => sendTo('initimage', 'init image')} />
                        )}
                        {canReuse && mediaParam.available('promptimages') && (
                            <ReuseButton
                                label="Use as image prompt"
                                onClick={() => sendTo('promptimages', 'image prompt')}
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => setShowMetadata(o => !o)}
                            aria-pressed={showMetadata}
                            title="Image metadata"
                            className="rounded border border-default bg-surface p-1.5 text-fg-soft hover:text-fg"
                        >
                            <Info size={15} aria-hidden />
                        </button>
                    </div>
                )}

                {reuse && (
                    <p className="absolute bottom-3 right-3 rounded border border-default bg-surface px-2 py-1 text-xs text-fg-soft">
                        {reuse}
                    </p>
                )}
            </div>

            {showMetadata && current && (
                <aside className="w-80 shrink-0 overflow-auto border-l border-subtle bg-surface p-3">
                    <h2 className="mb-2 text-sm font-medium text-fg-strong">Metadata</h2>
                    <MetadataView metadata={current.metadata} empty="No metadata for this image." />
                </aside>
            )}
        </div>
    );
}

/** Sends the current image into a media param. Text rather than a glyph: "which button reuses this
 *  image" is exactly the thing the legacy icon strip makes you hover to find out. */
function ReuseButton(props: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className="rounded border border-default bg-surface px-2 py-1.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
        >
            {props.label}
        </button>
    );
}
