import { useRef, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { imageUrl, useGenerateStore } from '@/generate/store';
import { previewToThumbnail } from '@/tools/modelSource';
import { isPlaceholderImage, previewUrl } from '@/library/types';
import { useTranslation } from '@/i18n';

/** A pending change to a model's or wildcard's preview image. */
export type PreviewChange = { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; dataUrl: string };

export const KEEP_PREVIEW: PreviewChange = { kind: 'keep' };

/** The `preview_image` value EditModelMetadata and EditWildcard take for a change: null leaves the
 *  image alone, 'clear' removes it, anything else is the new image as a data URL. */
export function previewValue(change: PreviewChange): string | null {
    return change.kind === 'keep' ? null : change.kind === 'clear' ? 'clear' : change.dataUrl;
}

/** The image the Generate screen is showing, if it has finished - legacy's edit dialogs offer that
 *  one as the new preview (currentImageHelper.getCurrentImage in models.js editModel). */
function useCurrentImage(): string | undefined {
    const src = useGenerateStore(s => {
        const item = s.batch.find(slot => slot.id === s.selected);
        return item && item.status === 'done' && !item.isPreview ? item.src : undefined;
    });
    return imageUrl(src);
}

/** Preview image picker for the metadata editors: upload a file, take the current Generate image,
 *  or clear it. Images are shrunk to the ~256px thumbnails the server stores. */
export function PreviewImageEditor(props: {
    /** The preview as it is now. */
    current: string | null | undefined;
    value: PreviewChange;
    onChange: (change: PreviewChange) => void;
}) {
    const { t } = useTranslation();
    const currentImage = useCurrentImage();
    const fileInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const shown =
        props.value.kind === 'set'
            ? props.value.dataUrl
            : props.value.kind === 'clear' || isPlaceholderImage(props.current)
              ? undefined
              : previewUrl(props.current);

    async function take(url: string, kind: 'image' | 'video'): Promise<void> {
        setBusy(true);
        setError(null);
        try {
            const dataUrl = await previewToThumbnail({ url, kind });
            if (dataUrl) {
                props.onChange({ kind: 'set', dataUrl });
            }
            else {
                setError(t('previewEditor.readFailed'));
            }
        }
        finally {
            setBusy(false);
        }
    }

    async function upload(file: File): Promise<void> {
        const url = URL.createObjectURL(file);
        try {
            await take(url, file.type.startsWith('video/') ? 'video' : 'image');
        }
        finally {
            URL.revokeObjectURL(url);
        }
    }

    const buttonClass =
        'rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg disabled:opacity-40';

    return (
        <div className="flex items-start gap-2">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded border border-subtle bg-surface-sunken">
                {busy ? (
                    <Loader2 size={16} className="animate-spin text-fg-soft" aria-hidden />
                ) : shown ? (
                    <img src={shown} alt="" className="h-full w-full object-cover" />
                ) : (
                    <ImageOff size={18} className="text-fg-soft opacity-40" aria-hidden />
                )}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={buttonClass}>
                    {t('previewEditor.upload')}
                </button>
                {currentImage && (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void take(currentImage, 'image')}
                        className={buttonClass}
                    >
                        {t('previewEditor.useCurrent')}
                    </button>
                )}
                <button
                    type="button"
                    disabled={busy || props.value.kind === 'clear' || (props.value.kind === 'keep' && !shown)}
                    onClick={() => props.onChange({ kind: 'clear' })}
                    className={buttonClass}
                >
                    {t('common.clear')}
                </button>
                {props.value.kind !== 'keep' && (
                    <button type="button" disabled={busy} onClick={() => props.onChange(KEEP_PREVIEW)} className={buttonClass}>
                        {t('previewEditor.keep')}
                    </button>
                )}
                {error && (
                    <p className="w-full text-xs" style={{ color: 'var(--backend-errored)' }}>
                        {error}
                    </p>
                )}
                <input
                    ref={fileInput}
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) {
                            void upload(file);
                        }
                    }}
                />
            </div>
        </div>
    );
}
