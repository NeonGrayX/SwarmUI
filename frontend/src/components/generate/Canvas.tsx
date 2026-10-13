import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, GripVertical, Info, Maximize, MoreHorizontal, Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { imageUrl, useGenerateStore } from '@/generate/store';
import { DisconnectedNotice } from './DisconnectedNotice';
import { useOpenEditor } from '@/editor/useOpenEditor';
import { fileToDataUrl } from '@/params/media';
import { useApplyRawImageMetadata } from '@/params/reuse';
import { useParamSchema } from '@/params/schema';
import { useUserSetting } from '@/settings/useUserSetting';
import { MetadataView } from '../ui/MetadataView';
import { DetailSheet } from '../ui/DetailSheet';
import { OutputPlayer, outputKind } from '../ui/OutputMedia';
import { ZoomableImage } from '../ui/ZoomableImage';
import { useContextMenu } from '../ui/ContextMenu';
import { useTranslation } from '@/i18n';
import { navigableIds, shiftCycles, stepBatch, useBatchViewStore } from './batchView';
import { interpretMetadata, readEmbeddedMetadataText } from './embeddedMetadata';
import { imageFileName } from './imageActions';
import { startImageDrag } from './imageDrag';
import { actionKey, DEFAULT_MAIN_BUTTONS, useBatchItemActions, type ImageActionDef } from './useBatchItemActions';
import { WelcomeMessage } from './WelcomeMessage';

/** Whether keyboard focus is somewhere typing happens, where the arrow keys are not ours. */
function isEditable(element: Element | null): boolean {
    if (!(element instanceof HTMLElement)) {
        return false;
    }
    return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/** The main image view and the actions under it, plus a collapsible metadata panel. The
 *  full-screen viewer and compare view it opens live in BatchViewer. */
export function Canvas() {
    const { t } = useTranslation();
    // Only the shown slot and the order of the steppable ones: a progress tick on another slot
    // re-renders the rail, not the canvas.
    const current = useGenerateStore(s => s.batch.find(item => item.id === s.selected));
    const ids = useGenerateStore(useShallow(s => navigableIds(s.batch)));
    const addResult = useGenerateStore(s => s.addResult);
    const dismissGenerateError = useGenerateStore(s => s.clearError);
    const error = useGenerateStore(s => s.error);
    const setViewing = useBatchViewStore(s => s.setViewing);
    const [showMetadata, setShowMetadata] = useState(false);
    const [dropping, setDropping] = useState(false);
    const editor = useOpenEditor();
    const schema = useParamSchema();
    const applyRawMetadata = useApplyRawImageMetadata();
    const contextMenu = useContextMenu();
    const itemActions = useBatchItemActions();
    const { notice, setNotice } = itemActions;
    const cycleSetting = useUserSetting<string>('ui.imageshiftingcycles', 'true');
    const mainButtons = useUserSetting<string>('buttonsundermainimages', '');
    const centerGrow = useUserSetting<boolean>('centerimagealwaysgrow', false);

    const src = imageUrl(current?.src);
    // A video model's previews are still images, so what is on screen mid-run is an image even
    // when the finished output will not be.
    const kind = src && !current?.isPreview ? outputKind(src) : 'image';
    const cycles = shiftCycles(cycleSetting, true);

    const step = useCallback((delta: number) => void stepBatch(delta, cycles), [cycles]);

    // Arrow keys walk the batch whenever focus is on the page itself, the canvas or the rail -
    // not in a field, and not in some other widget that has its own use for them. A focused image
    // handles its own arrows (and marks them handled), so they are not counted twice.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || useBatchViewStore.getState().compare) {
                return;
            }
            const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
            if (delta === 0) {
                return;
            }
            const active = document.activeElement;
            const inScope = !active || active === document.body || active.closest('[data-batch-nav]') !== null;
            if (!inScope || isEditable(active)) {
                return;
            }
            e.preventDefault();
            step(delta);
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [step]);

    // An error belongs to the run that raised it; once the user moves on to another finished image
    // it is old news, and must not keep sitting above a perfectly good one.
    const shownKey = current?.status === 'done' ? current.id : null;
    const lastShown = useRef(shownKey);
    useEffect(() => {
        if (shownKey !== null && shownKey !== lastShown.current && useGenerateStore.getState().error) {
            dismissGenerateError();
        }
        lastShown.current = shownKey;
    }, [shownKey]);

    // The confirmation is a nicety, not a state the user has to dismiss.
    useEffect(() => {
        if (notice) {
            const timer = setTimeout(() => setNotice(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [notice, setNotice]);

    const closeMetadata = useCallback(() => setShowMetadata(false), []);

    /** Shows a dropped or pasted image file, and loads the parameters it carries into the form.
     *  A .json file is taken as bare metadata. Mirrors imageInputHandler (currentimagehandler.js). */
    async function loadFile(file: File) {
        const name = file.name;
        try {
            if (file.type === 'application/json' || name.endsWith('.json')) {
                const raw = await file.text();
                applyRawMetadata(raw);
                setNotice(t('canvas.droppedParams', { name }));
                return;
            }
            if (!file.type.startsWith('image/')) {
                setNotice(t('canvas.dropNotImage', { name }));
                return;
            }
            const [data, raw] = await Promise.all([fileToDataUrl(file), readEmbeddedMetadataText(file)]);
            const known = schema ? new Set(schema.byId.keys()) : undefined;
            addResult(data, interpretMetadata(raw, known));
            if (!raw) {
                setNotice(t('canvas.dropNoParams', { name }));
                return;
            }
            applyRawMetadata(raw);
            setNotice(t('canvas.droppedParams', { name }));
        }
        catch (e: unknown) {
            setNotice(e instanceof Error ? e.message : t('canvas.dropFailed', { name }));
        }
    }

    const actions = current ? itemActions.actionsFor(current) : [];
    const mainKeys = useMemo(() => {
        const keys = (mainButtons.trim() || DEFAULT_MAIN_BUTTONS).split(',').map(actionKey).filter(Boolean);
        // One button edits whichever kind of output is showing.
        return keys.includes('editimage') ? [...keys, 'editvideo'] : keys;
    }, [mainButtons]);
    const primary = mainKeys
        .map(key => actions.find(action => action.key === key))
        .filter((action): action is ImageActionDef => action !== undefined);
    const more = actions.filter(action => !primary.includes(action));

    return (
        <div className="flex flex-1 min-h-0 min-w-0">
            <div
                data-batch-nav=""
                className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
                onDragOver={e => {
                    if (e.dataTransfer.types.includes('Files')) {
                        e.preventDefault();
                        setDropping(true);
                    }
                }}
                onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
                onDrop={e => {
                    const file = e.dataTransfer.files[0];
                    setDropping(false);
                    if (file) {
                        e.preventDefault();
                        void loadFile(file);
                    }
                }}
                onPaste={e => {
                    const file = e.clipboardData.files[0];
                    if (file && !isEditable(e.target as Element)) {
                        e.preventDefault();
                        void loadFile(file);
                    }
                }}
            >
                {/* Stacked rather than layered, so a notice never covers another, or the image. */}
                <div className="shrink-0 space-y-2 px-4 pt-3 empty:hidden">
                    {error && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded border p-3 text-sm"
                            style={{
                                borderColor: 'var(--sw-error-border)',
                                background: 'var(--sw-error-tint)'
                            }}
                        >
                            <p className="min-w-0 flex-1 break-words">{error}</p>
                            <button
                                type="button"
                                onClick={dismissGenerateError}
                                aria-label={t('common.dismissError')}
                                title={t('common.dismissError')}
                                className="shrink-0 rounded p-0.5 text-fg-soft hover:text-fg"
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </div>
                    )}

                    {/* Deliberately not styled as an error: the run itself is most likely fine, and
                        the images it is still producing will be waiting in the history. */}
                    <DisconnectedNotice />
                </div>

                <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
                    {src ? (
                        kind === 'image' ? (
                            <ZoomableImage
                                src={src}
                                alt={current?.isPreview ? t('canvas.previewAlt') : t('canvas.imageAlt')}
                                isPreview={current?.isPreview}
                                grow={current?.isPreview || centerGrow}
                                resetKey={current?.id}
                                onPrev={ids.length > 1 ? () => step(-1) : undefined}
                                onNext={ids.length > 1 ? () => step(1) : undefined}
                            />
                        ) : (
                            <OutputPlayer src={src} label={t('canvas.mediaAlt')} />
                        )
                    ) : (
                        <WelcomeMessage>
                            {editor.available && (
                                <button
                                    type="button"
                                    onClick={editor.newCanvas}
                                    className="mt-4 rounded border border-default px-2.5 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    {t('canvas.newCanvas')}
                                </button>
                            )}
                        </WelcomeMessage>
                    )}

                    {dropping && (
                        <div
                            className="pointer-events-none absolute inset-2 flex items-center justify-center rounded border-2 border-dashed text-sm text-fg"
                            style={{ borderColor: 'var(--emphasis)', background: 'color-mix(in srgb, var(--sw-surface) 70%, transparent)' }}
                        >
                            {t('canvas.dropHint')}
                        </div>
                    )}

                    {notice && (
                        <p
                            role="status"
                            className="absolute bottom-3 right-3 z-10 max-w-96 rounded border border-default bg-surface px-2 py-1 text-xs text-fg-soft"
                        >
                            {notice}
                        </p>
                    )}
                </div>

                {current && (
                    <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 border-t border-subtle px-3 py-2">
                        {primary.map(action => (
                            <ActionButton key={action.key} action={action} />
                        ))}
                        {more.length > 0 && (
                            <button
                                type="button"
                                onClick={e =>
                                    contextMenu.open(
                                        e,
                                        more.map(action => ({
                                            label: action.label,
                                            destructive: action.destructive,
                                            separated: action.key === 'delete',
                                            onSelect: () => action.run()
                                        }))
                                    )
                                }
                                className="flex items-center gap-1 rounded border border-default bg-surface px-2 py-1.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                <MoreHorizontal size={13} aria-hidden />
                                {t('imageActions.more')}
                            </button>
                        )}
                        <span className="mx-1 h-5 border-l border-subtle" aria-hidden />
                        {src && !current.isPreview && (
                            <span
                                draggable
                                onDragStart={e => startImageDrag(e, { url: src, metadata: current.metadata })}
                                title={t('canvas.dragHint')}
                                aria-label={t('canvas.dragHint')}
                                className="cursor-grab rounded border border-default bg-surface p-1.5 text-fg-soft hover:text-fg"
                            >
                                <GripVertical size={15} aria-hidden />
                            </span>
                        )}
                        {src && (
                            <IconButton label={t('viewer.open')} onClick={() => setViewing(current.id)}>
                                <Maximize size={15} aria-hidden />
                            </IconButton>
                        )}
                        {src && !current.isPreview && kind !== 'audio' && (
                            <IconButton
                                label={t('imageActions.compare')}
                                onClick={() =>
                                    useBatchViewStore
                                        .getState()
                                        .openCompare({ url: src, metadata: current.metadata, label: imageFileName(src) })
                                }
                            >
                                <Columns2 size={15} aria-hidden />
                            </IconButton>
                        )}
                        <IconButton
                            label={t('canvas.imageMetadata')}
                            pressed={showMetadata}
                            onClick={() => setShowMetadata(o => !o)}
                        >
                            <Info size={15} aria-hidden />
                        </IconButton>
                    </div>
                )}
            </div>

            {showMetadata && current && (
                <DetailSheet label={t('canvas.metadata')} onClose={closeMetadata} width="w-80">
                    <h2 className="shrink-0 px-3 pt-3 text-sm font-medium text-fg-strong">
                        {t('canvas.metadata')}
                    </h2>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        <MetadataView metadata={current.metadata} empty={t('canvas.noMetadata')} />
                    </div>
                </DetailSheet>
            )}

            {contextMenu.menu}
            {itemActions.dialogs}
        </div>
    );
}

/** One of the actions under the image. Labelled with text rather than a glyph, since "which button
 *  reuses this image" is not guessable from an icon. */
function ActionButton(props: { action: ImageActionDef }) {
    const { action } = props;
    return (
        <button
            type="button"
            onClick={e => action.run({ shiftKey: e.shiftKey })}
            aria-pressed={action.pressed}
            className="flex items-center gap-1.5 rounded border border-default bg-surface px-2 py-1.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
            style={action.destructive ? { color: 'var(--backend-errored)' } : undefined}
        >
            {action.key === 'star' && (
                <Star
                    size={13}
                    fill={action.pressed ? 'currentColor' : 'none'}
                    style={action.pressed ? { color: 'var(--star)' } : undefined}
                    aria-hidden
                />
            )}
            {action.label}
        </button>
    );
}

function IconButton(props: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-pressed={props.pressed}
            title={props.label}
            aria-label={props.label}
            className="rounded border border-default bg-surface p-1.5 text-fg-soft hover:text-fg"
        >
            {props.children}
        </button>
    );
}
