import { Film, Music } from 'lucide-react';
import { kindOfValue } from '@/params/media';
import { useTranslation } from '@/i18n';

/** Showing a generated output when it may not be an image.
 *
 * Video and audio models write into the same output history as image models, so every surface that
 * lists outputs has to be ready for one. Nothing in a listing says what a file is, so the kind is
 * read off the path the same way a media param reads its own value (kindOfValue). */

/** What to render an output as. Anything unrecognised is an image, which is what almost all of
 *  them are and what every one of these surfaces used to assume. */
export function outputKind(src: string): 'image' | 'video' | 'audio' {
    return kindOfValue(src, 'image');
}

/** A tile-sized output: the history grid, the batch rail, a list row.
 *
 * Videos show their first frame rather than playing, which is all a grid of a hundred of them can
 * afford, and carry a corner glyph so they read as videos while they sit still. */
export function OutputThumbnail(props: {
    src: string;
    alt: string;
    className: string;
    style?: React.CSSProperties;
}) {
    const { t } = useTranslation();
    const kind = outputKind(props.src);

    if (kind === 'audio') {
        return (
            <span
                className={`${props.className} flex items-center justify-center text-fg-soft`}
                title={props.alt}
                style={props.style}
            >
                <Music size={18} aria-hidden />
            </span>
        );
    }
    if (kind === 'video') {
        return (
            <span className="relative block h-full w-full">
                <video
                    // A media fragment is what asks for a poster frame without a second request for
                    // one; a `data:` video has no server to ask, and shows its own first frame.
                    src={props.src.startsWith('data:') ? props.src : `${props.src}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={props.alt}
                    className={props.className}
                    style={props.style}
                />
                <span
                    className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/60 p-0.5 text-white"
                    title={t('media.video')}
                >
                    <Film size={11} aria-hidden />
                </span>
            </span>
        );
    }
    return (
        <img
            src={props.src}
            alt={props.alt}
            loading="lazy"
            className={props.className}
            style={props.style}
        />
    );
}

/** A playable output at full size: the canvas, the viewer, a detail panel.
 *
 * Native controls rather than a bespoke transport - this is the plain "watch it" view, and the one
 * place that needs its own scrubbing (the video editor) draws its own timeline anyway. */
export function OutputPlayer(props: { src: string; label: string; className?: string }) {
    const kind = outputKind(props.src);

    if (kind === 'audio') {
        return (
            <audio
                src={props.src}
                controls
                aria-label={props.label}
                className={props.className ?? 'w-full max-w-lg'}
            />
        );
    }
    return (
        <video
            src={props.src}
            controls
            loop
            playsInline
            aria-label={props.label}
            className={props.className ?? 'max-h-full max-w-full object-contain'}
        />
    );
}
