/** Trimming, cropping, scaling and audio-splitting a video, through the server's ffmpeg routes.
 *
 * EditVideo and ExtractVideoAudio (src/WebAPI/T2IAPI.cs:652 and :590) take their video the same two
 * ways a media param does - a reusable server path, or the content inlined as a `data:` URL - and
 * both save what they produce under `inputs/`, handing back the saved path relative to the user's
 * output directory.
 *
 * Every bound stated here is the server's, restated so the editor never offers a setting that would
 * come back as an error: the trim range (T2IAPI.cs:665), the crop bounds (:669) and the scale
 * factor (:673). Ported from VideoEditorInterface (src/wwwroot/js/genpage/helpers/video_editor.js).
 */

import { api } from '@/api/client';
import { isServerMediaPath, serverMediaPath, urlToDataUrl } from '@/params/media';

/** How much daylight the trim handles keep between them. The server rejects an end at or before
 *  the start, and both are rounded to whole milliseconds before it checks. */
export const MIN_TRIM_SECONDS = 0.05;

/** The scale slider's range. An ffmpeg re-encode past 4x is not something to put a slider under,
 *  so the track stops there and the box beside it goes as far as the server does. */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const SCALE_STEP = 0.05;
/** The server's own ceiling (T2IAPI.cs:673), and so what may be typed. */
export const SCALE_LIMIT = 16;

/** Pixel grid the crop corners snap to, unless Shift is held. */
export const CROP_SNAP = 8;

/** The crop rectangle as fractions of the frame, which is what the overlay drags in. */
export interface CropBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export const FULL_FRAME: CropBounds = { left: 0, top: 0, right: 1, bottom: 1 };

export function isFullFrame(bounds: CropBounds): boolean {
    return bounds.left === 0 && bounds.top === 0 && bounds.right === 1 && bounds.bottom === 1;
}

/** Trim points in seconds, as the timeline holds them. */
export interface TrimRange {
    start: number;
    end: number;
}

export interface TrimRequest {
    startMilliseconds: number;
    endMilliseconds: number;
}

export interface CropRequest {
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
}

export interface EditVideoRequest extends TrimRequest, CropRequest {
    scale: number;
}

/** Frame size in pixels, read off the loaded video. */
export interface FrameSize {
    width: number;
    height: number;
}

/** A trim as the API takes it. An end left at the last frame is sent as -1 rather than a timestamp,
 *  so a video whose duration the browser rounded differently is not clipped short of its own end. */
export function trimRequest(trim: TrimRange, duration: number): TrimRequest {
    return {
        startMilliseconds: Math.round(trim.start * 1000),
        endMilliseconds:
            Math.abs(trim.end - duration) < 0.001 ? -1 : Math.round(trim.end * 1000)
    };
}

/** A crop as the API takes it: whole even pixels, and all four zero for the untouched frame.
 *  The server requires even width and height, and requires the pair to be both zero or neither. */
export function cropRequest(bounds: CropBounds, frame: FrameSize): CropRequest {
    if (isFullFrame(bounds) || frame.width <= 0 || frame.height <= 0) {
        return { cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0 };
    }
    const cropX = Math.floor((bounds.left * frame.width) / 2) * 2;
    const cropY = Math.floor((bounds.top * frame.height) / 2) * 2;
    return {
        cropX,
        cropY,
        cropWidth: Math.max(2, Math.floor((Math.ceil(bounds.right * frame.width) - cropX) / 2) * 2),
        cropHeight: Math.max(2, Math.floor((Math.ceil(bounds.bottom * frame.height) - cropY) / 2) * 2)
    };
}

/** The size the server will actually write, so the readout beside the slider is a prediction rather
 *  than a wish: scaling rounds each axis to a multiple of 16 with a floor of 16, and the pad filter
 *  that follows it only ever evens out an odd number (UserImageHistoryHelper.cs:178-180). */
export function outputSize(frame: FrameSize, crop: CropRequest, scale: number): FrameSize {
    let width = crop.cropWidth || frame.width;
    let height = crop.cropHeight || frame.height;
    if (scale !== 1) {
        width = Math.max(16, Math.round((width * scale) / 16) * 16);
        height = Math.max(16, Math.round((height * scale) / 16) * 16);
    }
    return { width, height };
}

/** `mm:ss.hh`, with an hours field only for a video long enough to need one. */
export function formatTime(seconds: number): string {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe - hours * 3600) / 60);
    const rest = safe - hours * 3600 - minutes * 60;
    const head = hours > 0 ? `${String(hours).padStart(2, '0')}:` : '';
    return `${head}${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** The browser-specific ways of asking whether a video carries sound. None is universal and none
 *  is required, so an unknown answer counts as yes: the split button stays offered, and a video
 *  that turns out to be silent says so through the server's own error. */
interface AudioProbe extends HTMLVideoElement {
    audioTracks?: { length: number };
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
}

export function hasAudioTrack(video: HTMLVideoElement): boolean {
    const probe = video as AudioProbe;
    if (probe.readyState < HTMLMediaElement.HAVE_METADATA) {
        return true;
    }
    if (probe.audioTracks) {
        return probe.audioTracks.length > 0;
    }
    if (typeof probe.mozHasAudio === 'boolean') {
        return probe.mozHasAudio;
    }
    if (typeof probe.webkitAudioDecodedByteCount === 'number') {
        return probe.webkitAudioDecodedByteCount > 0;
    }
    return true;
}

/** What to hand the API as its `video`.
 *
 * A path the server can reach again is far cheaper than the file's own bytes, so an output that is
 * already sitting under the user's output directory travels as its path; anything else - a blob, a
 * data URL, some other origin - has to be inlined. */
export async function videoSourceFor(url: string): Promise<string> {
    const path = serverMediaPath(url);
    return isServerMediaPath(path) ? path : urlToDataUrl(url);
}

/** Trims, crops and scales a video. Returns the saved path, relative to the output directory. */
export async function editVideo(
    video: string,
    filename: string,
    request: EditVideoRequest
): Promise<string> {
    const result = await api.post<{ result: string }>('EditVideo', { video, filename, ...request });
    return result.result;
}

/** Splits a video's audio out as MP3. Returns the saved path, relative to the output directory. */
export async function extractVideoAudio(
    video: string,
    filename: string,
    trim: TrimRequest
): Promise<string> {
    const result = await api.post<{ result: string }>('ExtractVideoAudio', {
        video,
        filename,
        ...trim
    });
    return result.result;
}
