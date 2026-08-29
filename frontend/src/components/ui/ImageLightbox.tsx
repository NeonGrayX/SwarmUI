import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ZoomableImage } from './ZoomableImage';
import { useTranslation } from '@/i18n';

/** Full-screen image viewer: one image at a time, zoomable, with the rest of its set a click,
 *  an arrow key or a swipe away.
 *
 * The caller owns which image is shown - it passes the current one and the steps either side - so
 * whatever opened the viewer (a browser's detail panel, say) stays in step with it rather than the
 * two drifting apart. Omitting `onPrev`/`onNext` is how an end of the set, or a lone image, is
 * expressed. */
export function ImageLightbox(props: {
    src: string;
    alt: string;
    /** Shown in the header bar. Usually the file name. */
    title: string;
    /** Where this image sits in the set, one-based, for the counter beside the title. */
    position?: { index: number; total: number };
    onPrev?: () => void;
    onNext?: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const { onClose } = props;

    // Captured at the document, ahead of every other Escape handler in the page, so closing the
    // viewer leaves the detail panel it was opened from open behind it.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                onClose();
            }
        }
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    // Portalled and fixed: the viewer belongs to the viewport, not to whichever pane the image was
    // clicked in, several nested `overflow-hidden` containers down.
    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('viewer.label')}
            className="fixed inset-0 z-50 flex flex-col bg-black/90"
        >
            <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-white">
                <h2 className="min-w-0 flex-1 truncate text-sm" title={props.title}>
                    {props.title}
                </h2>
                {props.position && (
                    <span className="shrink-0 text-xs tabular-nums opacity-70">
                        {t('viewer.position', { index: props.position.index, total: props.position.total })}
                    </span>
                )}
                <ViewerButton label={t('common.close')} onClick={onClose}>
                    <X size={18} aria-hidden />
                </ViewerButton>
            </div>

            {/* The margin the image viewport leaves around itself dismisses too, so every dark
                pixel that is not a control behaves the same way. */}
            <div
                className="relative min-h-0 flex-1"
                onClick={e => e.target === e.currentTarget && onClose()}
            >
                <ZoomableImage
                    src={props.src}
                    alt={props.alt}
                    resetKey={props.src}
                    autoFocus
                    onPrev={props.onPrev}
                    onNext={props.onNext}
                    onBackdropClick={onClose}
                />

                {/* Sat outside the image's own viewport, so a click on one never lands on the pan
                    handler underneath it. */}
                <div className="pointer-events-none absolute inset-0 flex justify-between">
                    <StepColumn label={t('viewer.previous')} onClick={props.onPrev}>
                        <ChevronLeft size={28} aria-hidden />
                    </StepColumn>
                    <StepColumn label={t('viewer.next')} onClick={props.onNext}>
                        <ChevronRight size={28} aria-hidden />
                    </StepColumn>
                </div>
            </div>
        </div>,
        document.body
    );
}

function ViewerButton(props: { label: string; onClick: () => void; children: React.ReactNode }) {
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

/** A step through the set: a tall strip down one side of the viewer, so reaching the next image is
 *  a flick of the wrist rather than a hunt for a small chevron.
 *
 *  At the ends of the set there is nothing to step to, and the strip becomes an inert spacer that
 *  lets clicks through to the backdrop behind it - a dead button there would swallow them. */
function StepColumn(props: { label: string; onClick?: () => void; children: React.ReactNode }) {
    const width = 'w-[16vw] min-w-16 max-w-80';
    if (!props.onClick) {
        return <span aria-hidden className={width} />;
    }
    return (
        <button
            type="button"
            onClick={props.onClick}
            title={props.label}
            aria-label={props.label}
            className={[
                width,
                // Tailwind's base leaves buttons on the default arrow; over a strip this large,
                // with only the chevron to look at, the cursor is the affordance.
                'group pointer-events-auto flex cursor-pointer items-center justify-center focus-visible:outline-none'
            ].join(' ')}
        >
            <span className="rounded-full bg-black/40 p-2 text-white/70 transition group-hover:bg-black/70 group-hover:text-white group-focus-visible:bg-black/70 group-focus-visible:text-white">
                {props.children}
            </span>
        </button>
    );
}
