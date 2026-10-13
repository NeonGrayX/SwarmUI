import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, FolderOpen, Maximize2, X } from 'lucide-react';
import { useGenerateStore, imageUrl } from '@/generate/store';
import { fileToDataUrl } from '@/params/media';
import { useTranslation } from '@/i18n';
import { OutputThumbnail, outputKind } from '../ui/OutputMedia';
import { useBatchViewStore, type CompareImage } from './batchView';
import { draggedImage, isImageOrFileDrag } from './imageDrag';
import { imageFileName } from './imageActions';

/** How the two images share the screen. Mirrors the legacy compare modes
 *  (ImageCompareHelper.modeDefinitions, currentimagehandler.js). */
type CompareMode = 'side' | 'slideX' | 'slideY' | 'fade';

const MODES: { id: CompareMode; labelKey: string }[] = [
    { id: 'side', labelKey: 'compare.mode.side' },
    { id: 'slideX', labelKey: 'compare.mode.slideX' },
    { id: 'slideY', labelKey: 'compare.mode.slideY' },
    { id: 'fade', labelKey: 'compare.mode.fade' }
];

const MIN_SCALE = 1;
const MAX_SCALE = 16;
const ZOOM_RATE = 1.1;

interface View {
    scale: number;
    x: number;
    y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

/** Two images against each other, zoomed and panned together. Rendered once, by the canvas; opened
 *  through useBatchViewStore.openCompare from anywhere. */
export function ImageCompare() {
    const compare = useBatchViewStore(s => s.compare);
    if (!compare) {
        return null;
    }
    return <CompareDialog left={compare.left} right={compare.right} />;
}

function CompareDialog(props: { left: CompareImage; right: CompareImage | null }) {
    const { t } = useTranslation();
    const close = useBatchViewStore(s => s.closeCompare);
    const swap = useBatchViewStore(s => s.swapCompare);
    const setRight = useBatchViewStore(s => s.setCompareRight);
    const [mode, setMode] = useState<CompareMode>('slideX');
    const [split, setSplit] = useState(50);
    const [opacity, setOpacity] = useState(50);
    const [view, setView] = useState<View>(FIT);
    const [dropping, setDropping] = useState(false);
    const stageRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    /** The active drag: moving the divider, or panning from a last point. */
    const drag = useRef<{ kind: 'split' } | { kind: 'pan'; x: number; y: number } | null>(null);
    const { left, right } = props;

    // Captured ahead of every other Escape handler, like the image viewer, so closing the compare
    // view leaves whatever opened it as it was.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                close();
            }
        }
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [close]);

    // A non-passive listener, since React's onWheel cannot preventDefault the page scroll.
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) {
            return;
        }
        function onWheel(e: WheelEvent) {
            e.preventDefault();
            const box = stage!.getBoundingClientRect();
            // Zoomed about the cursor, as an offset from the stage's centre.
            const cx = e.clientX - box.left - box.width / 2;
            const cy = e.clientY - box.top - box.height / 2;
            setView(current => {
                const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * Math.pow(ZOOM_RATE, -e.deltaY / 100)));
                if (scale <= MIN_SCALE) {
                    return FIT;
                }
                const k = scale / current.scale;
                return { scale, x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k };
            });
        }
        stage.addEventListener('wheel', onWheel, { passive: false });
        return () => stage.removeEventListener('wheel', onWheel);
    }, [right]);

    const moveSplit = useCallback(
        (clientX: number, clientY: number) => {
            const box = stageRef.current?.getBoundingClientRect();
            if (!box) {
                return;
            }
            const fraction = mode === 'slideY' ? (clientY - box.top) / box.height : (clientX - box.left) / box.width;
            setSplit(Math.min(100, Math.max(0, fraction * 100)));
        },
        [mode]
    );

    function onPointerDown(e: React.PointerEvent) {
        if (e.button !== 0) {
            return;
        }
        const onDivider = e.target instanceof Element && e.target.closest('[data-compare-divider]');
        // In a slide mode the divider follows any drag until zoomed, when a drag pans instead.
        if (onDivider || ((mode === 'slideX' || mode === 'slideY') && view.scale <= MIN_SCALE)) {
            drag.current = { kind: 'split' };
            moveSplit(e.clientX, e.clientY);
        }
        else if (view.scale > MIN_SCALE) {
            drag.current = { kind: 'pan', x: e.clientX, y: e.clientY };
        }
        else {
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent) {
        const current = drag.current;
        if (!current) {
            return;
        }
        if (current.kind === 'split') {
            moveSplit(e.clientX, e.clientY);
            return;
        }
        const dx = e.clientX - current.x;
        const dy = e.clientY - current.y;
        drag.current = { kind: 'pan', x: e.clientX, y: e.clientY };
        setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }

    function onPointerUp() {
        drag.current = null;
    }

    async function pickFile(file: File | undefined) {
        if (!file || !file.type.startsWith('image/')) {
            return;
        }
        setRight({ url: await fileToDataUrl(file), label: file.name });
    }

    function onDrop(e: React.DragEvent) {
        e.preventDefault();
        setDropping(false);
        const swarm = draggedImage(e.dataTransfer);
        if (swarm) {
            setRight({ url: swarm.url, metadata: swarm.metadata, label: imageFileName(swarm.url) });
            return;
        }
        void pickFile(e.dataTransfer.files[0]);
    }

    const transform: CSSProperties = {
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    };

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('compare.label')}
            className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white"
            onDragOver={e => {
                if (isImageOrFileDrag(e.dataTransfer)) {
                    e.preventDefault();
                    setDropping(true);
                }
            }}
            onDragLeave={e => e.currentTarget === e.target && setDropping(false)}
            onDrop={onDrop}
        >
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
                <h2 className="min-w-0 flex-1 truncate text-sm" title={`${left.label} / ${right?.label ?? ''}`}>
                    {right ? t('compare.title', { left: left.label, right: right.label }) : left.label}
                </h2>
                {right && (
                    <>
                        <div className="flex rounded border border-white/20" role="group" aria-label={t('compare.modeLabel')}>
                            {MODES.map(entry => (
                                <button
                                    key={entry.id}
                                    type="button"
                                    aria-pressed={mode === entry.id}
                                    onClick={() => setMode(entry.id)}
                                    className={[
                                        'px-2 py-1 text-xs',
                                        mode === entry.id ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'
                                    ].join(' ')}
                                >
                                    {t(entry.labelKey)}
                                </button>
                            ))}
                        </div>
                        {mode === 'fade' && (
                            <label className="flex items-center gap-1.5 text-xs text-white/80">
                                {t('compare.opacity')}
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={opacity}
                                    onChange={e => setOpacity(Number(e.target.value))}
                                    className="w-28 accent-[var(--emphasis)]"
                                />
                                <span className="w-8 tabular-nums">{opacity}%</span>
                            </label>
                        )}
                        <HeaderButton label={t('compare.swap')} onClick={swap}>
                            <ArrowLeftRight size={16} aria-hidden />
                        </HeaderButton>
                        <HeaderButton label={t('zoom.fit')} onClick={() => setView(FIT)}>
                            <Maximize2 size={16} aria-hidden />
                        </HeaderButton>
                        <HeaderButton label={t('compare.change')} onClick={() => setRight(null)}>
                            <FolderOpen size={16} aria-hidden />
                        </HeaderButton>
                    </>
                )}
                <HeaderButton label={t('common.close')} onClick={close}>
                    <X size={18} aria-hidden />
                </HeaderButton>
            </div>

            {right ? (
                <div
                    ref={stageRef}
                    className="relative min-h-0 flex-1 select-none overflow-hidden"
                    style={{ touchAction: 'none', cursor: view.scale > MIN_SCALE ? 'grab' : mode === 'slideX' ? 'ew-resize' : mode === 'slideY' ? 'ns-resize' : 'default' }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onDoubleClick={() => setView(FIT)}
                >
                    {mode === 'side' ? (
                        <div className="absolute inset-0 flex gap-1">
                            <Layer image={left} transform={transform} className="relative flex-1 overflow-hidden" />
                            <Layer image={right} transform={transform} className="relative flex-1 overflow-hidden" />
                        </div>
                    ) : (
                        <>
                            <Layer image={left} transform={transform} className="absolute inset-0 overflow-hidden" />
                            <Layer
                                image={right}
                                transform={transform}
                                className="absolute inset-0 overflow-hidden"
                                style={
                                    mode === 'fade'
                                        ? { opacity: opacity / 100 }
                                        : mode === 'slideX'
                                          ? { clipPath: `inset(0 0 0 ${split}%)` }
                                          : { clipPath: `inset(${split}% 0 0 0)` }
                                }
                            />
                            {mode !== 'fade' && (
                                <div
                                    data-compare-divider=""
                                    className="absolute"
                                    style={
                                        mode === 'slideX'
                                            ? { left: `${split}%`, top: 0, bottom: 0, width: 12, marginLeft: -6, cursor: 'ew-resize' }
                                            : { top: `${split}%`, left: 0, right: 0, height: 12, marginTop: -6, cursor: 'ns-resize' }
                                    }
                                >
                                    <span
                                        aria-hidden
                                        className="absolute bg-white/80 shadow"
                                        style={
                                            mode === 'slideX'
                                                ? { left: 5, top: 0, bottom: 0, width: 2 }
                                                : { top: 5, left: 0, right: 0, height: 2 }
                                        }
                                    />
                                </div>
                            )}
                            <span className="pointer-events-none absolute left-2 top-2 max-w-[45%] truncate rounded bg-black/60 px-1.5 py-0.5 text-xs">
                                {left.label}
                            </span>
                            <span className="pointer-events-none absolute right-2 top-2 max-w-[45%] truncate rounded bg-black/60 px-1.5 py-0.5 text-xs">
                                {right.label}
                            </span>
                        </>
                    )}
                </div>
            ) : (
                <ComparePicker
                    exclude={left.url}
                    dropping={dropping}
                    onPick={setRight}
                    onBrowse={() => fileRef.current?.click()}
                />
            )}

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                    void pickFile(e.target.files?.[0]);
                    e.target.value = '';
                }}
            />
        </div>,
        document.body
    );
}

/** One image, filling its box and following the shared zoom. */
function Layer(props: { image: CompareImage; transform: CSSProperties; className: string; style?: CSSProperties }) {
    return (
        <div className={props.className} style={props.style}>
            <img
                src={props.image.url}
                alt={props.image.label}
                draggable={false}
                className="h-full w-full object-contain"
                style={props.transform}
            />
        </div>
    );
}

/** Choosing the second image: any other finished image in the batch, a file, or a drop. */
function ComparePicker(props: {
    exclude: string;
    dropping: boolean;
    onPick: (image: CompareImage) => void;
    onBrowse: () => void;
}) {
    const { t } = useTranslation();
    const batch = useGenerateStore(s => s.batch);
    const candidates = batch.filter(item => {
        const url = imageUrl(item.src);
        return url && !item.isPreview && item.status === 'done' && url !== props.exclude && outputKind(url) === 'image';
    });
    return (
        <div
            className={[
                'm-4 flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto rounded border-2 border-dashed p-6',
                props.dropping ? 'border-[var(--emphasis)]' : 'border-white/20'
            ].join(' ')}
        >
            <p className="text-sm text-white/80">{t('compare.pickHint')}</p>
            <button
                type="button"
                onClick={props.onBrowse}
                className="flex items-center gap-1.5 rounded border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
            >
                <FolderOpen size={14} aria-hidden />
                {t('compare.chooseFile')}
            </button>
            {candidates.length > 0 && (
                <div className="grid w-full max-w-4xl grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
                    {candidates.map(item => {
                        const url = imageUrl(item.src)!;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => props.onPick({ url, metadata: item.metadata, label: imageFileName(url) })}
                                className="aspect-square overflow-hidden rounded border border-white/20 hover:border-[var(--emphasis)]"
                            >
                                <OutputThumbnail src={url} alt={imageFileName(url)} className="h-full w-full object-cover" />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function HeaderButton(props: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            title={props.label}
            aria-label={props.label}
            className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
        >
            {props.children}
        </button>
    );
}
