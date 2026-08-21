import { useEffect, useState } from 'react';
import { ImageIcon, Info } from 'lucide-react';
import { imageUrl, useGenerateStore } from '@/generate/store';
import { useMediaParamAction } from '@/params/useMediaParamAction';
import { MetadataView } from '../ui/MetadataView';
import { DetailSheet } from '../ui/DetailSheet';
import { ZoomableImage } from './ZoomableImage';
import { useTranslation } from '@/i18n';

/** The main image view, plus a collapsible metadata panel. */
export function Canvas() {
    const { t } = useTranslation();
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
            .then(() => setReuse(t('canvas.sentTo', { target: label })))
            .catch((e: unknown) =>
                setReuse(e instanceof Error ? e.message : t('canvas.sendFailed', { target: label }))
            );
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
            <div className="relative flex flex-1 min-w-0 items-center justify-center overflow-hidden p-4">
                {error && (
                    <div
                        className="absolute inset-x-4 top-4 rounded border p-3 text-sm"
                        style={{
                            borderColor: 'var(--sw-error-border)',
                            background: 'var(--sw-error-tint)'
                        }}
                    >
                        {error}
                    </div>
                )}

                {src ? (
                    <ZoomableImage
                        src={src}
                        alt={current?.isPreview ? t('canvas.previewAlt') : t('canvas.imageAlt')}
                        isPreview={current?.isPreview}
                        resetKey={current?.id}
                    />
                ) : (
                    <div className="text-center text-fg-soft">
                        <ImageIcon size={40} className="mx-auto mb-3 opacity-40" aria-hidden />
                        <p>{t('canvas.noImage')}</p>
                        <p className="mt-1 text-sm">{t('canvas.noImageHint')}</p>
                    </div>
                )}

                {current && (
                    <div className="absolute right-3 top-3 flex items-center gap-1.5">
                        {canReuse && mediaParam.available('initimage') && (
                            <ReuseButton
                                label={t('canvas.useAsInitImage')}
                                onClick={() => sendTo('initimage', t('canvas.target.initImage'))}
                            />
                        )}
                        {canReuse && mediaParam.available('promptimages') && (
                            <ReuseButton
                                label={t('canvas.useAsImagePrompt')}
                                onClick={() => sendTo('promptimages', t('canvas.target.imagePrompt'))}
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => setShowMetadata(o => !o)}
                            aria-pressed={showMetadata}
                            title={t('canvas.imageMetadata')}
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
                <DetailSheet
                    label={t('canvas.metadata')}
                    onClose={() => setShowMetadata(false)}
                    width="w-80"
                >
                    <h2 className="shrink-0 px-3 pt-3 text-sm font-medium text-fg-strong">
                        {t('canvas.metadata')}
                    </h2>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        <MetadataView metadata={current.metadata} empty={t('canvas.noMetadata')} />
                    </div>
                </DetailSheet>
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
