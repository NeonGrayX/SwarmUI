import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from '@/i18n';

/** Scale 1 is "fits the viewport". */
const MIN_SCALE = 1;
const MAX_SCALE = 16;
/** Zoom step per wheel notch. */
const ZOOM_RATE = 1.1;
/** How far a finger has to travel horizontally to count as "next image" rather than a stray tap. */
const SWIPE_MIN = 60;
/** Movement below this still counts as a click rather than a drag. */
const CLICK_SLOP = 6;
const FIT: View = { scale: 1, x: 0, y: 0 };

interface View {
    /** Multiple of the fitted size. */
    scale: number;
    /** Pan offset in screen pixels, from centred. */
    x: number;
    y: number;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

/** Keeps the image inside the viewport: it can be pushed only as far as its own edges, and sits
 *  centred on any axis where it is smaller than the viewport. */
function clampPan(view: View, viewport: HTMLElement | null, img: HTMLImageElement | null): View {
    if (!viewport || !img) {
        return view;
    }
    const maxX = Math.max(0, (img.offsetWidth * view.scale - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * view.scale - viewport.clientHeight) / 2);
    return { scale: view.scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The image itself, zoomable by wheel, pinch, buttons or keyboard, and pannable once zoomed in. */
export function ZoomableImage(props: {
    src: string;
    alt: string;
    /** Previews are half-finished renders, dimmed slightly so they do not read as the result. */
    isPreview?: boolean;
    /** Changing this resets the view - a new image should always start out fitted. */
    resetKey?: string;
    /** Steps to the neighbouring image, when the caller is showing a set rather than one image.
     *  Left alone the arrow keys only pan, and a swipe does nothing. */
    onPrev?: () => void;
    onNext?: () => void;
    /** Takes keyboard focus on mount, for a viewer that opened onto nothing else. */
    autoFocus?: boolean;
    /** Called for a click that lands beside the image rather than on it - the "click the dark bit
     *  to dismiss" every full-screen viewer has. Drags that end there do not count. */
    onBackdropClick?: () => void;
}) {
    const [view, setView] = useState<View>(FIT);
    const viewportRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    /** Live pointers, so one finger pans and two pinch. */
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const pinchDist = useRef(0);
    const dragging = useRef(false);
    /** Where a lone pointer went down, for the swipe that steps between images. */
    const swipeStart = useRef<{ x: number; y: number } | null>(null);
    /** Whether the pointer travelled since it went down, so a pan that happens to end on the
     *  backdrop is not mistaken for a click on it. */
    const dragged = useRef(false);
    const [panning, setPanning] = useState(false);
    const zoomed = view.scale > 1.001;

    /** Rescales around a point in client space (the viewport centre when none is given), so the
     *  pixel under the cursor stays under the cursor. */
    const zoom = useCallback((next: (current: number) => number, clientX?: number, clientY?: number) => {
        setView(current => {
            const viewport = viewportRef.current;
            const img = imgRef.current;
            const scale = clamp(next(current.scale), MIN_SCALE, MAX_SCALE);
            if (!viewport || !img) {
                return { ...current, scale };
            }
            const rect = viewport.getBoundingClientRect();
            const anchorX = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
            const anchorY = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
            const ratio = scale / current.scale;
            const panned = {
                scale,
                x: anchorX - ratio * (anchorX - current.x),
                y: anchorY - ratio * (anchorY - current.y)
            };
            return clampPan(panned, viewport, img);
        });
    }, []);

    const pan = useCallback((deltaX: number, deltaY: number) => {
        setView(current =>
            clampPan(
                { scale: current.scale, x: current.x + deltaX, y: current.y + deltaY },
                viewportRef.current,
                imgRef.current
            )
        );
    }, []);

    // A wheel over the image should zoom rather than scroll the page, which needs a non-passive
    // listener - React's onWheel is registered passive and cannot preventDefault.
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) {
            return;
        }
        function onWheel(e: WheelEvent) {
            e.preventDefault();
            zoom(scale => scale * Math.pow(ZOOM_RATE, -e.deltaY / 100), e.clientX, e.clientY);
        }
        viewport.addEventListener('wheel', onWheel, { passive: false });
        return () => viewport.removeEventListener('wheel', onWheel);
    }, [zoom]);

    // A resized panel changes what "inside the viewport" means, so a zoomed-in view can end up
    // parked off-screen.
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) {
            return;
        }
        const observer = new ResizeObserver(() => {
            setView(current => clampPan(current, viewportRef.current, imgRef.current));
        });
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        setView(FIT);
    }, [props.resetKey]);

    useEffect(() => {
        if (props.autoFocus) {
            viewportRef.current?.focus();
        }
    }, [props.autoFocus]);

    /** Toggles between fitted and one screen pixel per image pixel - the view worth checking detail
     *  in. An image small enough to be upscaled by the fit has no such view, so it just doubles. */
    function toggleNative(clientX?: number, clientY?: number) {
        const img = imgRef.current;
        if (!img || !img.offsetWidth) {
            return;
        }
        const native = Math.max(2, img.naturalWidth / img.offsetWidth);
        zoom(scale => (scale > 1.001 ? 1 : native), clientX, clientY);
    }

    function onPointerDown(e: React.PointerEvent) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const points = [...pointers.current.values()];
        swipeStart.current = points.length === 1 ? { x: e.clientX, y: e.clientY } : null;
        dragged.current = false;
        if (points.length === 2) {
            pinchDist.current = distance(points[0], points[1]);
        }
        else if (points.length === 1 && view.scale > 1) {
            dragging.current = true;
            setPanning(true);
        }
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent) {
        const previous = pointers.current.get(e.pointerId);
        if (!previous) {
            return;
        }
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const start = swipeStart.current;
        if (start && distance(start, { x: e.clientX, y: e.clientY }) > CLICK_SLOP) {
            dragged.current = true;
        }
        const points = [...pointers.current.values()];
        if (points.length >= 2) {
            const spread = distance(points[0], points[1]);
            if (pinchDist.current > 0 && spread > 0) {
                const factor = spread / pinchDist.current;
                zoom(scale => scale * factor, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
            }
            pinchDist.current = spread;
        }
        else if (dragging.current) {
            pan(e.clientX - previous.x, e.clientY - previous.y);
        }
    }

    function onPointerUp(e: React.PointerEvent) {
        const start = swipeStart.current;
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) {
            pinchDist.current = 0;
        }
        if (pointers.current.size > 0) {
            return;
        }
        dragging.current = false;
        swipeStart.current = null;
        setPanning(false);
        // A fitted image has nothing to pan, so a flick across it steps to the neighbouring one.
        // Only by touch or pen: a mouse has the arrow keys and the on-screen buttons, and stepping
        // on a stray click-drag would be a nasty surprise.
        if (start && !zoomed && e.pointerType !== 'mouse') {
            const dx = e.clientX - start.x;
            if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
                (dx < 0 ? props.onNext : props.onPrev)?.();
            }
        }
    }

    /** Dismisses on a click that landed beside the image. Tested against the image's box rather
     *  than the event target, because the pointer capture taken for panning retargets the click to
     *  the viewport whether or not the image was under it. */
    function onClick(e: React.MouseEvent) {
        const img = imgRef.current;
        if (!props.onBackdropClick || dragged.current || !img) {
            return;
        }
        const box = img.getBoundingClientRect();
        const onImage =
            e.clientX >= box.left && e.clientX <= box.right &&
            e.clientY >= box.top && e.clientY <= box.bottom;
        if (!onImage) {
            props.onBackdropClick();
        }
    }

    function onKeyDown(e: React.KeyboardEvent) {
        const step = e.shiftKey ? 120 : 40;
        const keys: Record<string, () => void> = {
            '+': () => zoom(scale => scale * 1.25),
            '=': () => zoom(scale => scale * 1.25),
            '-': () => zoom(scale => scale / 1.25),
            '0': () => setView(FIT),
            // Panning is what the arrows are for once there is somewhere to pan to; until then
            // they walk the set, which is what they mean in every other image viewer.
            ArrowLeft: () => (zoomed ? pan(step, 0) : props.onPrev?.()),
            ArrowRight: () => (zoomed ? pan(-step, 0) : props.onNext?.()),
            ArrowUp: () => pan(0, step),
            ArrowDown: () => pan(0, -step)
        };
        const action = keys[e.key];
        if (action) {
            e.preventDefault();
            action();
        }
    }

    const { t } = useTranslation();

    return (
        <div className="absolute inset-4">
            <div
                ref={viewportRef}
                tabIndex={0}
                role="group"
                aria-label={t('zoom.viewHint')}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onClick={onClick}
                onDoubleClick={e => toggleNative(e.clientX, e.clientY)}
                onKeyDown={onKeyDown}
                className="absolute inset-0 flex items-center justify-center overflow-hidden"
                style={{ touchAction: 'none', cursor: !zoomed ? 'default' : panning ? 'grabbing' : 'grab' }}
            >
                <img
                    ref={imgRef}
                    src={props.src}
                    alt={props.alt}
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                    style={{
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        filter: props.isPreview ? 'saturate(0.9)' : undefined
                    }}
                />
            </div>

            {/* Above anything a caller lays over the viewer - the lightbox's step columns reach
                into this corner - so the zoom controls stay reachable. */}
            <div className="absolute bottom-0 left-0 z-10 flex items-center gap-1 rounded border border-default bg-surface p-1 text-fg-soft">
                <ZoomButton label={t('zoom.out')} onClick={() => zoom(scale => scale / 1.25)} disabled={!zoomed}>
                    <ZoomOut size={15} aria-hidden />
                </ZoomButton>
                <button
                    type="button"
                    onClick={() => toggleNative()}
                    title={zoomed ? t('zoom.fit') : t('zoom.fullSize')}
                    className="min-w-12 rounded px-1 text-xs tabular-nums hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    {Math.round(view.scale * 100)}%
                </button>
                <ZoomButton label={t('zoom.in')} onClick={() => zoom(scale => scale * 1.25)} disabled={view.scale >= MAX_SCALE}>
                    <ZoomIn size={15} aria-hidden />
                </ZoomButton>
                <ZoomButton label={t('zoom.fit')} onClick={() => setView(FIT)} disabled={!zoomed}>
                    <Maximize2 size={15} aria-hidden />
                </ZoomButton>
            </div>
        </div>
    );
}

function ZoomButton(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            title={props.label}
            aria-label={props.label}
            className="rounded p-1 hover:text-fg hover:bg-[var(--sw-hover)] disabled:opacity-40 disabled:hover:text-fg-soft disabled:hover:bg-transparent"
        >
            {props.children}
        </button>
    );
}
