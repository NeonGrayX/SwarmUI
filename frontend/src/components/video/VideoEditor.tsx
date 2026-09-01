import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Pause, Play, RotateCcw, Scissors, X } from 'lucide-react';
import { describeAspectRatio } from '@/params/media';
import {
    cropRequest,
    editVideo,
    extractVideoAudio,
    formatTime,
    hasAudioTrack,
    isFullFrame,
    outputSize,
    trimRequest,
    videoSourceFor,
    CROP_SNAP,
    FULL_FRAME,
    MAX_SCALE,
    MIN_SCALE,
    MIN_TRIM_SECONDS,
    SCALE_LIMIT,
    SCALE_STEP,
    type CropBounds,
    type FrameSize,
    type TrimRange
} from '@/video/edit';
import { useTranslation } from '@/i18n';

const NO_FRAME: FrameSize = { width: 0, height: 0 };
const NO_TRIM: TrimRange = { start: 0, end: 0 };

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

/** Which corner of the crop rectangle a handle drags. */
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
type Corner = (typeof CORNERS)[number];

/** Trim, crop and scale a video, or split its audio out.
 *
 * Ported from VideoEditorInterface (src/wwwroot/js/genpage/helpers/video_editor.js). The server does
 * the work through EditVideo and ExtractVideoAudio; everything here is choosing what to send them
 * and showing what the result will be. Both routes save under `inputs/` and hand back the path,
 * which is what `onSaved` carries out to whichever screen opened the editor.
 *
 * Playback is deliberately kept inside the trim range: a trim you cannot watch is a guess. */
export function VideoEditor(props: {
    /** Loadable URL of the video being edited. */
    src: string;
    /** Names the saved file, and titles the dialog. */
    name: string;
    onClose: () => void;
    /** The saved file's path, relative to the user's output directory. May fire more than once -
     *  splitting the audio and saving the video are two separate saves off the same edit. */
    onSaved: (path: string) => void;
}) {
    const { t } = useTranslation();

    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    const [frame, setFrame] = useState<FrameSize>(NO_FRAME);
    const [duration, setDuration] = useState(0);
    const [trim, setTrim] = useState<TrimRange>(NO_TRIM);
    const [crop, setCrop] = useState<CropBounds>(FULL_FRAME);
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [audible, setAudible] = useState(true);
    const [saving, setSaving] = useState<'video' | 'audio' | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Pointer maths runs outside React's render, so the values it reads have to be the ones on
    // screen right now rather than the ones this render closed over.
    const trimRef = useRef<TrimRange>(NO_TRIM);
    const cropRef = useRef<CropBounds>(FULL_FRAME);
    const timelineDrag = useRef<{ pointer: number; side: 'start' | 'end' | null } | null>(null);
    const cropDrag = useRef<{ pointer: number; corner: Corner } | null>(null);

    function applyTrim(next: TrimRange): void {
        trimRef.current = next;
        setTrim(next);
    }

    function applyCrop(next: CropBounds): void {
        cropRef.current = next;
        setCrop(next);
    }

    function seek(time: number): void {
        const video = videoRef.current;
        if (video) {
            video.currentTime = time;
            setPosition(time);
        }
    }

    /** Everything the timeline and the readouts need, once the browser has parsed the file. */
    function onMetadata(): void {
        const video = videoRef.current;
        if (!video) {
            return;
        }
        const length = Number.isFinite(video.duration) ? video.duration : 0;
        setFrame({ width: video.videoWidth, height: video.videoHeight });
        setDuration(length);
        applyTrim({ start: 0, end: length });
        applyCrop(FULL_FRAME);
        setPosition(0);
        setAudible(hasAudioTrack(video));
        setError(null);
    }

    /** Keeps playback inside the trim, so what plays is what would be saved.
     *
     * Only while it is actually playing: dragging the end handle seeks there deliberately, and
     * bouncing the playhead back to the start on every such seek would make the handle unusable. */
    function onTimeUpdate(): void {
        const video = videoRef.current;
        if (!video) {
            return;
        }
        const { start, end } = trimRef.current;
        if (!video.paused && end > start && video.currentTime >= end) {
            video.pause();
            seek(start);
            return;
        }
        setPosition(video.currentTime);
    }

    function togglePlay(): void {
        const video = videoRef.current;
        if (!video) {
            return;
        }
        if (video.paused) {
            const { start, end } = trimRef.current;
            // Pressing play with the cursor parked outside the trim means "play the trim".
            if (video.currentTime < start || video.currentTime >= end) {
                video.currentTime = start;
            }
            void video.play().catch(() => setPlaying(false));
        }
        else {
            video.pause();
        }
    }

    /* ---- Timeline -------------------------------------------------------------------------- */

    function timelineFraction(clientX: number): number | null {
        const rect = timelineRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) {
            return null;
        }
        return clamp((clientX - rect.left) / rect.width, 0, 1);
    }

    /** Seeks, or moves whichever trim handle the press started on. */
    function applyTimelinePointer(clientX: number): void {
        const fraction = timelineFraction(clientX);
        if (fraction === null || duration <= 0) {
            return;
        }
        const time = fraction * duration;
        const gap = Math.min(MIN_TRIM_SECONDS, duration);
        const side = timelineDrag.current?.side;
        const current = trimRef.current;
        if (side === 'start') {
            const start = Math.min(time, current.end - gap);
            applyTrim({ ...current, start });
            seek(start);
        }
        else if (side === 'end') {
            const end = Math.max(time, current.start + gap);
            applyTrim({ ...current, end });
            seek(end);
        }
        else {
            seek(time);
        }
    }

    /** Nudges a trim handle from the keyboard, for anyone not dragging with a pointer. */
    function nudgeTrim(side: 'start' | 'end', seconds: number): void {
        const gap = Math.min(MIN_TRIM_SECONDS, duration);
        const current = trimRef.current;
        if (side === 'start') {
            const start = clamp(current.start + seconds, 0, current.end - gap);
            applyTrim({ ...current, start });
            seek(start);
        }
        else {
            const end = clamp(current.end + seconds, current.start + gap, duration);
            applyTrim({ ...current, end });
            seek(end);
        }
    }

    /* ---- Crop ------------------------------------------------------------------------------ */

    /** Moves the dragged corner, keeping the rectangle inside the frame and the right way round. */
    function applyCropPointer(clientX: number, clientY: number, fine: boolean): void {
        const rect = overlayRef.current?.getBoundingClientRect();
        const drag = cropDrag.current;
        if (!rect || !drag || rect.width <= 0 || rect.height <= 0) {
            return;
        }
        let x = clamp((clientX - rect.left) / rect.width, 0, 1);
        let y = clamp((clientY - rect.top) / rect.height, 0, 1);
        // Video encoders like round numbers, so the corners land on an 8px grid unless the user
        // asks for the exact pixel by holding Shift.
        if (!fine && frame.width > 0 && frame.height > 0) {
            x = clamp((Math.round((x * frame.width) / CROP_SNAP) * CROP_SNAP) / frame.width, 0, 1);
            y = clamp((Math.round((y * frame.height) / CROP_SNAP) * CROP_SNAP) / frame.height, 0, 1);
        }
        // Two pixels is the narrowest the server's even-number rule can express.
        const minX = frame.width > 0 ? 2 / frame.width : 0.001;
        const minY = frame.height > 0 ? 2 / frame.height : 0.001;
        const next = { ...cropRef.current };
        if (drag.corner.includes('w')) {
            next.left = Math.min(x, next.right - minX);
        }
        else {
            next.right = Math.max(x, next.left + minX);
        }
        if (drag.corner.includes('n')) {
            next.top = Math.min(y, next.bottom - minY);
        }
        else {
            next.bottom = Math.max(y, next.top + minY);
        }
        applyCrop(next);
    }

    /** Keyboard equivalent: one grid step per press. */
    function nudgeCrop(corner: Corner, dx: number, dy: number): void {
        const stepX = frame.width > 0 ? CROP_SNAP / frame.width : 0.01;
        const stepY = frame.height > 0 ? CROP_SNAP / frame.height : 0.01;
        const minX = frame.width > 0 ? 2 / frame.width : 0.001;
        const minY = frame.height > 0 ? 2 / frame.height : 0.001;
        const next = { ...cropRef.current };
        if (corner.includes('w')) {
            next.left = clamp(next.left + dx * stepX, 0, next.right - minX);
        }
        else {
            next.right = clamp(next.right + dx * stepX, next.left + minX, 1);
        }
        if (corner.includes('n')) {
            next.top = clamp(next.top + dy * stepY, 0, next.bottom - minY);
        }
        else {
            next.bottom = clamp(next.bottom + dy * stepY, next.top + minY, 1);
        }
        applyCrop(next);
    }

    /* ---- Saving ---------------------------------------------------------------------------- */

    const cropped = cropRequest(crop, frame);
    const target = outputSize(frame, cropped, scale);
    const trimmed = trim.start > 0 || Math.abs(trim.end - duration) >= 0.001;
    // Re-encoding a video nobody has edited would only write a second copy of it. Splitting the
    // audio out is a change in its own right, so that button never depends on this.
    const edited = trimmed || !isFullFrame(crop) || scale !== 1;
    const ready = duration > 0 && saving === null;

    async function save(what: 'video' | 'audio'): Promise<void> {
        setSaving(what);
        setError(null);
        setSaved(null);
        try {
            const source = await videoSourceFor(props.src);
            const range = trimRequest(trimRef.current, duration);
            const path =
                what === 'audio'
                    ? await extractVideoAudio(source, props.name, range)
                    : await editVideo(source, props.name, { ...range, ...cropped, scale });
            setSaved(path);
            props.onSaved(path);
        }
        catch (e: unknown) {
            setError(e instanceof Error ? e.message : t('videoEditor.saveFailed'));
        }
        finally {
            setSaving(null);
        }
    }

    return (
        <Dialog.Root open onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(60rem,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-default bg-surface-raised shadow-2xl">
                    <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-2">
                        <Scissors size={15} className="shrink-0 text-fg-soft" aria-hidden />
                        <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong">
                            {t('videoEditor.title')}
                            <span className="ml-2 text-fg-soft" title={props.name}>
                                {props.name}
                            </span>
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={t('common.close')}
                                title={t('common.close')}
                                className="rounded p-1 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                            >
                                <X size={15} aria-hidden />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        <div className="flex justify-center rounded bg-surface-sunken p-2">
                            {/* Sized to the video rather than the other way round, so the crop
                                overlay laid over it lines up with the frame exactly. */}
                            <div
                                ref={overlayRef}
                                className="relative overflow-hidden"
                                style={{ width: 'fit-content', maxWidth: '100%' }}
                            >
                                <video
                                    ref={videoRef}
                                    src={props.src}
                                    playsInline
                                    preload="metadata"
                                    aria-label={props.name}
                                    onLoadedMetadata={onMetadata}
                                    onTimeUpdate={onTimeUpdate}
                                    onSeeked={onTimeUpdate}
                                    onPlay={() => setPlaying(true)}
                                    onPause={() => setPlaying(false)}
                                    onError={() => setError(t('videoEditor.loadFailed'))}
                                    className="block max-h-[45vh] max-w-full"
                                />

                                {/* Inert as a whole; only the corners take the pointer, so a press
                                    anywhere else still reaches the video underneath. */}
                                <div className="pointer-events-none absolute inset-0">
                                    <div
                                        className="absolute border border-dashed border-white/80"
                                        style={{
                                            left: `${crop.left * 100}%`,
                                            top: `${crop.top * 100}%`,
                                            width: `${(crop.right - crop.left) * 100}%`,
                                            height: `${(crop.bottom - crop.top) * 100}%`,
                                            // Dims everything outside the rectangle in one go,
                                            // rather than fitting four shades around it.
                                            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)'
                                        }}
                                    >
                                        {CORNERS.map(corner => (
                                            <CropHandle
                                                key={corner}
                                                corner={corner}
                                                label={t(`videoEditor.corner.${corner}`)}
                                                onDown={(pointer, element) => {
                                                    cropDrag.current = { pointer, corner };
                                                    element.setPointerCapture(pointer);
                                                }}
                                                onMove={(pointer, x, y, fine) => {
                                                    if (cropDrag.current?.pointer === pointer) {
                                                        applyCropPointer(x, y, fine);
                                                    }
                                                }}
                                                onUp={pointer => {
                                                    if (cropDrag.current?.pointer === pointer) {
                                                        cropDrag.current = null;
                                                    }
                                                }}
                                                onNudge={(dx, dy) => nudgeCrop(corner, dx, dy)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={togglePlay}
                                disabled={duration <= 0}
                                aria-label={playing ? t('videoEditor.pause') : t('videoEditor.play')}
                                title={playing ? t('videoEditor.pause') : t('videoEditor.play')}
                                className="shrink-0 rounded border border-default p-1.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg disabled:opacity-50"
                            >
                                {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                            </button>

                            <div
                                ref={timelineRef}
                                role="group"
                                aria-label={t('videoEditor.timeline')}
                                onPointerDown={event => {
                                    if (duration <= 0) {
                                        return;
                                    }
                                    event.preventDefault();
                                    timelineDrag.current = { pointer: event.pointerId, side: null };
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    applyTimelinePointer(event.clientX);
                                }}
                                onPointerMove={event => {
                                    if (timelineDrag.current?.pointer === event.pointerId) {
                                        applyTimelinePointer(event.clientX);
                                    }
                                }}
                                onPointerUp={event => {
                                    if (timelineDrag.current?.pointer === event.pointerId) {
                                        applyTimelinePointer(event.clientX);
                                        timelineDrag.current = null;
                                    }
                                }}
                                onPointerCancel={() => {
                                    timelineDrag.current = null;
                                }}
                                className="relative h-9 flex-1 cursor-pointer touch-none overflow-hidden rounded border border-default bg-surface-sunken"
                            >
                                <Excluded left={0} width={fraction(trim.start, duration)} />
                                <Excluded
                                    left={fraction(trim.end, duration)}
                                    width={100 - fraction(trim.end, duration)}
                                />
                                <span
                                    aria-hidden
                                    className="absolute inset-y-0 w-px bg-[var(--emphasis)]"
                                    style={{ left: `${fraction(position, duration)}%` }}
                                />
                                <TrimHandle
                                    label={t('videoEditor.trimStartHandle')}
                                    percent={fraction(trim.start, duration)}
                                    disabled={duration <= 0}
                                    onDown={(pointer, element) => {
                                        timelineDrag.current = { pointer, side: 'start' };
                                        element.setPointerCapture(pointer);
                                    }}
                                    onMove={(pointer, x) => {
                                        if (timelineDrag.current?.pointer === pointer) {
                                            applyTimelinePointer(x);
                                        }
                                    }}
                                    onUp={pointer => {
                                        if (timelineDrag.current?.pointer === pointer) {
                                            timelineDrag.current = null;
                                        }
                                    }}
                                    onNudge={seconds => nudgeTrim('start', seconds)}
                                />
                                <TrimHandle
                                    label={t('videoEditor.trimEndHandle')}
                                    percent={fraction(trim.end, duration)}
                                    disabled={duration <= 0}
                                    onDown={(pointer, element) => {
                                        timelineDrag.current = { pointer, side: 'end' };
                                        element.setPointerCapture(pointer);
                                    }}
                                    onMove={(pointer, x) => {
                                        if (timelineDrag.current?.pointer === pointer) {
                                            applyTimelinePointer(x);
                                        }
                                    }}
                                    onUp={pointer => {
                                        if (timelineDrag.current?.pointer === pointer) {
                                            timelineDrag.current = null;
                                        }
                                    }}
                                    onNudge={seconds => nudgeTrim('end', seconds)}
                                />
                            </div>
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-fg-soft">
                            <span>{t('videoEditor.trimStart', { time: formatTime(trim.start) })}</span>
                            <span>{t('videoEditor.position', { time: formatTime(position) })}</span>
                            <span>{t('videoEditor.trimEnd', { time: formatTime(trim.end) })}</span>
                            <span className="text-fg">
                                {t('videoEditor.length', { time: formatTime(trim.end - trim.start) })}
                            </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <label
                                htmlFor="video-editor-scale"
                                className="shrink-0 text-xs text-fg-soft"
                            >
                                {t('videoEditor.scale')}
                            </label>
                            <input
                                type="range"
                                aria-label={t('videoEditor.scale')}
                                min={MIN_SCALE}
                                max={MAX_SCALE}
                                step={SCALE_STEP}
                                value={clamp(scale, MIN_SCALE, MAX_SCALE)}
                                onChange={event => setScale(Number(event.target.value))}
                                className="min-w-24 flex-1 accent-[var(--emphasis)]"
                            />
                            <input
                                id="video-editor-scale"
                                type="number"
                                min={MIN_SCALE}
                                max={SCALE_LIMIT}
                                step={SCALE_STEP}
                                value={scale}
                                onChange={event => {
                                    const typed = Number(event.target.value);
                                    setScale(Number.isFinite(typed) ? typed : 1);
                                }}
                                onBlur={() => setScale(current => clamp(current, MIN_SCALE, SCALE_LIMIT))}
                                className="w-16 shrink-0 rounded border border-default bg-surface-sunken px-1 py-1 text-right text-sm tabular-nums text-fg outline-none focus:border-[var(--emphasis)]"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    applyCrop(FULL_FRAME);
                                    setScale(1);
                                }}
                                className="flex shrink-0 items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                            >
                                <RotateCcw size={12} aria-hidden />
                                {t('videoEditor.resetFrame')}
                            </button>
                        </div>

                        <p className="mt-2 text-xs tabular-nums text-fg-soft">
                            {frame.width > 0
                                ? `${frame.width}×${frame.height} (${describeAspectRatio(frame.width, frame.height)})` +
                                  ` → ${target.width}×${target.height} (${describeAspectRatio(target.width, target.height)})`
                                : t('common.loading')}
                        </p>

                        <Dialog.Description className="mt-2 text-xs text-fg-soft">
                            {t('videoEditor.hint')}
                        </Dialog.Description>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-subtle px-3 py-2">
                        <p className="min-w-0 flex-1 truncate text-xs">
                            {error ? (
                                <span style={{ color: 'var(--backend-errored)' }}>{error}</span>
                            ) : saved ? (
                                <span className="text-fg-soft" title={saved}>
                                    {t('videoEditor.saved', { path: saved })}
                                </span>
                            ) : null}
                        </p>
                        {audible && (
                            <button
                                type="button"
                                onClick={() => void save('audio')}
                                disabled={!ready}
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50"
                            >
                                {saving === 'audio' ? t('common.saving') : t('videoEditor.splitAudio')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void save('video')}
                            disabled={!ready || !edited}
                            title={edited ? undefined : t('videoEditor.nothingChanged')}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {saving === 'video' ? t('common.saving') : t('videoEditor.saveVideo')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** Where a time sits along the timeline, as a percentage. */
function fraction(time: number, duration: number): number {
    return duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0;
}

/** The shaded part of the timeline: video the trim would throw away. */
function Excluded(props: { left: number; width: number }) {
    return (
        <span
            aria-hidden
            className="absolute inset-y-0 bg-black/40"
            style={{ left: `${props.left}%`, width: `${Math.max(0, props.width)}%` }}
        />
    );
}

/** One end of the trim. A button rather than a bare div, so the range can be set without a
 *  pointer: the arrow keys move it by a tenth of a second, or a whole second with Shift. */
function TrimHandle(props: {
    label: string;
    percent: number;
    disabled: boolean;
    onDown: (pointer: number, element: HTMLElement) => void;
    onMove: (pointer: number, clientX: number) => void;
    onUp: (pointer: number) => void;
    onNudge: (seconds: number) => void;
}) {
    return (
        <button
            type="button"
            disabled={props.disabled}
            aria-label={props.label}
            title={props.label}
            onPointerDown={event => {
                event.preventDefault();
                event.stopPropagation();
                props.onDown(event.pointerId, event.currentTarget);
            }}
            onPointerMove={event => props.onMove(event.pointerId, event.clientX)}
            onPointerUp={event => props.onUp(event.pointerId)}
            onPointerCancel={event => props.onUp(event.pointerId)}
            onKeyDown={event => {
                const step = event.shiftKey ? 1 : 0.1;
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    props.onNudge(-step);
                }
                else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    props.onNudge(step);
                }
            }}
            className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize touch-none rounded-sm border border-white/70 bg-[var(--emphasis)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            style={{ left: `${props.percent}%` }}
        />
    );
}

/** One corner of the crop rectangle, draggable or arrow-keyed. */
function CropHandle(props: {
    corner: Corner;
    label: string;
    onDown: (pointer: number, element: HTMLElement) => void;
    onMove: (pointer: number, clientX: number, clientY: number, fine: boolean) => void;
    onUp: (pointer: number) => void;
    onNudge: (dx: number, dy: number) => void;
}) {
    const vertical = props.corner.startsWith('n') ? '-top-1.5' : '-bottom-1.5';
    const horizontal = props.corner.endsWith('w') ? '-left-1.5' : '-right-1.5';
    const cursor = props.corner === 'nw' || props.corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';

    return (
        <button
            type="button"
            aria-label={props.label}
            title={props.label}
            onPointerDown={event => {
                event.preventDefault();
                event.stopPropagation();
                props.onDown(event.pointerId, event.currentTarget);
            }}
            onPointerMove={event =>
                props.onMove(event.pointerId, event.clientX, event.clientY, event.shiftKey)
            }
            onPointerUp={event => props.onUp(event.pointerId)}
            onPointerCancel={event => props.onUp(event.pointerId)}
            onKeyDown={event => {
                const moves: Record<string, [number, number]> = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1]
                };
                const move = moves[event.key];
                if (move) {
                    event.preventDefault();
                    props.onNudge(move[0], move[1]);
                }
            }}
            className={[
                'pointer-events-auto absolute size-3 touch-none rounded-sm border border-black/50 bg-white',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--emphasis)]',
                vertical,
                horizontal,
                cursor
            ].join(' ')}
        />
    );
}
