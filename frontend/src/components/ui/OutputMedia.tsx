import { useEffect, useState } from 'react';
import { Film, Music } from 'lucide-react';
import { kindOfValue } from '@/params/media';
import { useTranslation } from '@/i18n';

/** Showing a generated output when it may not be an image.
 *
 * Video and audio models write into the same output history as image models, so every surface that
 * lists outputs has to be ready for one. Nothing in a listing says what a file is, so the kind is
 * read off the path the same way a media param reads its own value (kindOfValue). */

/** Routes that serve output files, and the only ones the preview query means anything to. Model
 *  icons, `data:` URLs and live generation previews all go through other paths. */
const OUTPUT_ROUTES = ['/View/', '/Output/'];

/** What to render an output as. Anything unrecognised is an image, which is what almost all of
 *  them are and what every one of these surfaces used to assume. */
export function outputKind(src: string): 'image' | 'video' | 'audio' {
    return kindOfValue(src, 'image');
}

/** The server's cached thumbnail of an output, for the surfaces that show it small.
 *
 * `?preview=true` answers out of the preview cache the server keeps beside its output metadata
 * (WebServer.ViewOutput -> OutputMetadataTracker.GetOrCreatePreviewFor) instead of with the file
 * itself: a 256px-short-side JPEG for an image, a 128px-tall webp for a video or an animation.
 * Measured on this repo's own output folder that is 16kB against an 8.8MB png, and 44kB against a
 * 2.1MB mp4 - the difference between a grid that fills in and one that trickles in for a minute.
 * `noanim=true` is deliberately not asked for: the still it returns for a video is a
 * full-resolution frame, which is *larger* than the animation it replaces.
 *
 * Anything that is not an output path is returned untouched, and so is an output whose preview the
 * server declines to make (the user's ImageHistoryUsePreviews setting, an unreadable format): it
 * serves the full file under that same URL, so asking is always safe. */
export function outputPreviewSrc(src: string): string {
    return OUTPUT_ROUTES.some(route => src.startsWith(route)) ? `${src}?preview=true` : src;
}

/** Shows an output's preview until the file itself has arrived.
 *
 * For a panel that was opened from a grid the preview is already in the browser's cache, so it
 * paints in the same frame as the click, and the full-size file - seconds of downloading away on a
 * slow connection - replaces it in place once it lands. Both are the same picture at the same
 * aspect ratio, so nothing moves when they swap.
 *
 * Returns `src` unchanged where there is no preview to stand in for it, and for anything that is
 * not an image - a video's preview is a still of it, which is no way to show the video. */
export function useProgressiveOutput(src: string): string {
    const preview = outputKind(src) === 'image' ? outputPreviewSrc(src) : src;
    const [loaded, setLoaded] = useState<string | null>(null);

    useEffect(() => {
        if (preview === src) {
            return undefined;
        }
        // Loaded off-screen rather than by swapping the visible src, so the preview stays on
        // screen for the whole download instead of blanking the moment the full one is asked for.
        const image = new Image();
        image.onload = () => setLoaded(src);
        image.src = src;
        return () => {
            image.onload = null;
        };
    }, [src, preview]);

    return loaded === src ? src : preview;
}

/** A tile-sized output: the history grid, the batch rail, a list row.
 *
 * Every kind of file is drawn from the server's preview of it rather than from the file, so a grid
 * of a hundred outputs costs a few megabytes rather than a few hundred. Videos carry a corner
 * glyph, since their preview is a small silent loop that could as well be an image. */
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
                <VideoThumbnail src={props.src} alt={props.alt} className={props.className} style={props.style} />
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
            src={outputPreviewSrc(props.src)}
            alt={props.alt}
            loading="lazy"
            decoding="async"
            className={props.className}
            style={props.style}
        />
    );
}

/** What a video tile shows.
 *
 * The server renders a small preview loop for every video it has (ffmpeg, into the same preview
 * cache the images use), which is tens of kilobytes against the megabytes a `<video>` element
 * pulls down just to find its first frame - and it is a picture, so a grid of them costs no video
 * decoders. Where there is no preview to be had - previews switched off, a `data:` video being
 * generated right now, a format ffmpeg would not read - that URL answers with the video itself,
 * which an `<img>` cannot draw, so the element it needs is put back on the failure. */
function VideoThumbnail(props: {
    src: string;
    alt: string;
    className: string;
    style?: React.CSSProperties;
}) {
    const preview = outputPreviewSrc(props.src);
    // Keyed by URL rather than a bare flag, so stepping a tile onto another video re-tries it.
    const [failed, setFailed] = useState<string | null>(null);

    if (preview === props.src || failed === preview) {
        return (
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
        );
    }
    return (
        <img
            src={preview}
            alt={props.alt}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(preview)}
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
