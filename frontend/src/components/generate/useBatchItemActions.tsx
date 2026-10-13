import { useCallback, useState, type ReactNode } from 'react';
import { useGenerateStore, imageUrl } from '@/generate/store';
import type { BatchItem } from '@/generate/types';
import { useOpenEditor } from '@/editor/useOpenEditor';
import { useMediaParamAction } from '@/params/useMediaParamAction';
import { useUserSetting } from '@/settings/useUserSetting';
import { useTranslation } from '@/i18n';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { outputKind } from '../ui/OutputMedia';
import { useVideoEditor } from '../video/useVideoEditor';
import { imageFileName, outputPathOf, useImageActions, type ActionImage } from './imageActions';
import {
    navigableIds,
    removeBatchItem,
    shiftCycles,
    stepId,
    useBatchViewStore
} from './batchView';

/** One thing that can be done with a batch image, keyed by its legacy button name lowercased with
 *  the spaces removed - the names the ButtonsUnderMainImages setting lists. */
export interface ImageActionDef {
    key: string;
    label: string;
    /** `shiftKey` skips the delete confirmation, as in the legacy UI. */
    run: (event?: { shiftKey?: boolean }) => void;
    destructive?: boolean;
    /** Set on a toggle that is currently on - the star. */
    pressed?: boolean;
}

/** The legacy default for ButtonsUnderMainImages. */
export const DEFAULT_MAIN_BUTTONS = 'Use As Init,Edit Image,Star,Reuse Parameters';

/** A ButtonsUnderMainImages entry as an action key. */
export function actionKey(name: string): string {
    const key = name.toLowerCase().replace(/\s+/g, '');
    return key === 'starred' || key === 'unstar' ? 'star' : key;
}

export interface BatchItemActions {
    /** Every action for one slot, in the legacy button order. */
    actionsFor: (item: BatchItem, options?: { inRail?: boolean }) => ImageActionDef[];
    /** Short status line after an action, or null. Cleared by the caller. */
    notice: string | null;
    setNotice: (text: string | null) => void;
    /** Confirmation and editor dialogs; render once. */
    dialogs: ReactNode;
}

/** The current-image buttons of the legacy UI, for whichever batch slot they are asked about. */
export function useBatchItemActions(): BatchItemActions {
    const { t } = useTranslation();
    const actions = useImageActions();
    const mediaParam = useMediaParamAction();
    const editor = useOpenEditor();
    const videoEditor = useVideoEditor();
    const confirmDelete = useUserSetting<boolean>('ui.checkifsurebeforedelete', true) !== false;
    const deleteBehavior = useUserSetting<string>('ui.deleteimagebehavior', 'next');
    const cycleSetting = useUserSetting<string>('ui.imageshiftingcycles', 'true');
    const [notice, setNotice] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<BatchItem | null>(null);

    /** Runs an action, reporting its failure (or, given `done`, its success) in the notice. */
    const report = useCallback(
        (work: Promise<unknown> | (() => unknown), done?: string) => {
            setNotice(null);
            Promise.resolve()
                .then(() => (typeof work === 'function' ? work() : work))
                .then(
                    () => done && setNotice(done),
                    (error: unknown) => setNotice(error instanceof Error ? error.message : t('imageActions.failed'))
                );
        },
        [t]
    );

    const doDelete = useCallback(
        (item: BatchItem) => {
            const url = imageUrl(item.src);
            if (!url) {
                return;
            }
            const ids = navigableIds(useGenerateStore.getState().batch);
            const next =
                deleteBehavior === 'nothing'
                    ? null
                    : stepId(ids, item.id, deleteBehavior === 'previous' ? -1 : 1, shiftCycles(cycleSetting, false));
            report(actions.deleteImage({ url, metadata: item.metadata }).then(() => removeBatchItem(item.id, next)));
        },
        [actions, deleteBehavior, cycleSetting, report]
    );

    const actionsFor = useCallback(
        (item: BatchItem, options: { inRail?: boolean } = {}): ImageActionDef[] => {
            const list: ImageActionDef[] = [];
            const url = imageUrl(item.src);
            const ids = navigableIds(useGenerateStore.getState().batch);
            const removeAction: ImageActionDef = {
                key: 'removefrombatchview',
                label: t('imageActions.removeFromBatch'),
                run: () => {
                    const selected = useGenerateStore.getState().selected;
                    removeBatchItem(item.id, selected === item.id ? (stepId(ids, item.id, -1, false) ?? stepId(ids, item.id, 1, false)) : selected);
                }
            };
            // A preview is a half-finished render: nothing but dropping it from view makes sense.
            if (!url || item.isPreview) {
                return options.inRail ? [removeAction] : [];
            }
            const image: ActionImage = { url, metadata: item.metadata };
            const kind = outputKind(url);
            const name = imageFileName(url);

            /** Sends the image to a media param, inlining it so the param survives a reload. */
            const sendTo = (paramId: string, target: string) =>
                report(mediaParam.set(paramId, url), t('canvas.sentTo', { target }));

            if (kind !== 'audio' && mediaParam.available('initimage')) {
                list.push({
                    key: 'useasinit',
                    label: t('canvas.useAsInitImage'),
                    run: () => sendTo('initimage', t('canvas.target.initImage'))
                });
            }
            if (kind === 'image' && mediaParam.available('promptimages')) {
                list.push({
                    key: 'useasimageprompt',
                    label: t('canvas.useAsImagePrompt'),
                    run: () => sendTo('promptimages', t('canvas.target.imagePrompt'))
                });
            }
            if (kind === 'image' && editor.available) {
                list.push({ key: 'editimage', label: t('canvas.editImage'), run: () => report(editor.editImage(url, name)) });
            }
            if (kind === 'video' && videoEditor.available) {
                list.push({ key: 'editvideo', label: t('videoEditor.open'), run: () => videoEditor.edit(url, name) });
            }
            if (kind === 'image' && actions.canUpscale) {
                list.push({ key: 'upscale2x', label: t('imageActions.upscale2x'), run: () => report(actions.upscale(image)) });
            }
            if (kind === 'image' && actions.canRefine) {
                list.push({ key: 'refineimage', label: t('imageActions.refine'), run: () => report(actions.refine(image)) });
            }
            if (actions.canStar(image)) {
                const starred = actions.isStarred(image);
                list.push({
                    key: 'star',
                    label: starred ? t('common.unstar') : t('common.star'),
                    pressed: starred,
                    run: () =>
                        report(actions.toggleStar(image).then(metadata => useGenerateStore.getState().setItemMetadata(item.id, metadata)))
                });
            }
            if (item.metadata) {
                list.push({
                    key: 'reuseparameters',
                    label: t('history.reuseParameters'),
                    run: () => report(() => actions.reuseParameters(image), t('imageActions.reused'))
                });
            }
            if (actions.hasPath(image)) {
                list.push({ key: 'viewinhistory', label: t('imageActions.viewInHistory'), run: () => actions.viewInHistory(image) });
            }
            if (item.metadata) {
                list.push({
                    key: 'copyrawmetadata',
                    label: t('imageActions.copyRawMetadata'),
                    run: () => report(actions.copyMetadata(image), t('imageActions.copied'))
                });
            }
            if (actions.hasPath(image)) {
                list.push({
                    key: 'copypath',
                    label: t('imageActions.copyPath'),
                    run: () => report(actions.copyPath(image), t('imageActions.copied'))
                });
            }
            if (actions.canOpenFolder(image)) {
                list.push({ key: 'openinfolder', label: t('imageActions.openInFolder'), run: () => report(actions.openFolder(image)) });
            }
            list.push({ key: 'download', label: t('common.download'), run: () => actions.download(image) });
            if (kind !== 'audio') {
                const view = useBatchViewStore.getState();
                const generate = useGenerateStore.getState();
                const selected = generate.batch.find(other => other.id === generate.selected);
                const selectedUrl = imageUrl(selected?.src);
                const left = { url, metadata: item.metadata, label: name };
                if (options.inRail && selected && selected.id !== item.id && selectedUrl && !selected.isPreview) {
                    list.push({
                        key: 'compare',
                        label: t('imageActions.compareWithCurrent'),
                        run: () =>
                            view.openCompare(
                                { url: selectedUrl, metadata: selected.metadata, label: imageFileName(selectedUrl) },
                                left
                            )
                    });
                }
                else {
                    list.push({ key: 'compare', label: t('imageActions.compare'), run: () => view.openCompare(left) });
                }
            }
            if (actions.canDelete(image)) {
                list.push({
                    key: 'delete',
                    label: t('common.delete'),
                    destructive: true,
                    run: event => {
                        if (confirmDelete && !event?.shiftKey) {
                            setPendingDelete(item);
                        }
                        else {
                            doDelete(item);
                        }
                    }
                });
            }
            if (options.inRail) {
                list.push(removeAction);
            }
            return list;
        },
        [t, actions, mediaParam, editor, videoEditor, confirmDelete, doDelete, report]
    );

    const dialogs = (
        <>
            <ConfirmDialog
                open={pendingDelete !== null}
                title={t('history.deleteTitle')}
                body={
                    <>
                        <code className="font-mono text-fg">
                            {pendingDelete?.src ? outputPathOf(imageUrl(pendingDelete.src) ?? '') : ''}
                        </code>{' '}
                        {t('history.deleteBody')}
                    </>
                }
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    if (pendingDelete) {
                        doDelete(pendingDelete);
                    }
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />
            {videoEditor.dialog}
        </>
    );

    return { actionsFor, notice, setNotice, dialogs };
}
