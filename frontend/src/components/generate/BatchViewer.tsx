import { useCallback, useEffect } from 'react';
import { Star } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { imageUrl, useGenerateStore } from '@/generate/store';
import type { BatchItem } from '@/generate/types';
import { useUserSetting } from '@/settings/useUserSetting';
import { useTranslation } from '@/i18n';
import { ImageLightbox } from '../ui/ImageLightbox';
import { navigableIds, shiftCycles, stepBatch, stepId, useBatchViewStore } from './batchView';
import { imageFileName } from './imageActions';
import { ImageCompare } from './ImageCompare';
import type { ImageActionDef } from './useBatchItemActions';

/** The batch's full-screen viewer and compare view. Rendered once, by the batch rail - the one
 *  part of the Generate screen that is always mounted, whichever pane or editor is showing - and
 *  opened through useBatchViewStore from anywhere. */
export function BatchViewer(props: { actionsFor: (item: BatchItem) => ImageActionDef[] }) {
    const { t } = useTranslation();
    const viewing = useBatchViewStore(s => s.viewing);
    const setViewing = useBatchViewStore(s => s.setViewing);
    const viewed = useGenerateStore(s => (viewing === null ? undefined : s.batch.find(item => item.id === viewing)));
    const selected = useGenerateStore(s => s.selected);
    const ids = useGenerateStore(useShallow(s => navigableIds(s.batch)));
    const cycles = shiftCycles(useUserSetting<string>('ui.imageshiftingcycles', 'true'), true);
    const autoSwapFullView = useUserSetting<boolean>('autoswapimagesincludesfullview', false) === true;
    const close = useCallback(() => setViewing(null), [setViewing]);

    // A new image arriving moves the canvas; the viewer only goes with it when the user asked for
    // that (legacy's AutoSwapImagesIncludesFullView). Stepping moves both itself.
    useEffect(() => {
        if (autoSwapFullView && selected && useBatchViewStore.getState().viewing !== null) {
            setViewing(selected);
        }
    }, [selected, autoSwapFullView, setViewing]);

    // A slot that has gone (removed, or the batch cleared) closes the viewer rather than leaving it
    // pointing at nothing.
    useEffect(() => {
        if (viewing !== null && !viewed) {
            setViewing(null);
        }
    }, [viewing, viewed, setViewing]);

    const url = imageUrl(viewed?.src);
    const index = viewed ? ids.indexOf(viewed.id) : -1;
    const star = viewed ? props.actionsFor(viewed).find(action => action.key === 'star') : undefined;

    return (
        <>
            {viewed && url && (
                <ImageLightbox
                    src={url}
                    alt={viewed.isPreview ? t('canvas.previewAlt') : t('canvas.imageAlt')}
                    title={imageFileName(url)}
                    position={index < 0 ? undefined : { index: index + 1, total: ids.length }}
                    onPrev={stepId(ids, viewed.id, -1, cycles) ? () => stepBatch(-1, cycles) : undefined}
                    onNext={stepId(ids, viewed.id, 1, cycles) ? () => stepBatch(1, cycles) : undefined}
                    onClose={close}
                    metadata={viewed.metadata ?? null}
                    actions={
                        star && (
                            <button
                                type="button"
                                onClick={() => star.run()}
                                title={star.label}
                                aria-label={star.label}
                                aria-pressed={star.pressed}
                                className="rounded p-1.5 hover:bg-white/10"
                                style={{ color: star.pressed ? 'var(--star)' : 'rgb(255 255 255 / 0.7)' }}
                            >
                                <Star size={18} fill={star.pressed ? 'currentColor' : 'none'} aria-hidden />
                            </button>
                        )
                    }
                />
            )}
            <ImageCompare />
        </>
    );
}
