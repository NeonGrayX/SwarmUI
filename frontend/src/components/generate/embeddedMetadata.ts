/** Reads the generation metadata embedded in an image file, entirely in the browser.
 *
 * Ports the legacy UI's parseMetadata / interpretMetadata (src/wwwroot/js/genpage/helpers/
 * metadatahelpers.js), minus its ExifReader dependency. Where the text lives depends on the format,
 * and mirrors what the server writes and reads (ImageFile.cs):
 *   - PNG: a `parameters` text chunk - tEXt, iTXt or zTXt,
 *   - JPEG / WebP: the EXIF UserComment, or failing that the EXIF Model tag,
 *   - any of them: "stealth" metadata hidden in the alpha channel's low bits, as a last resort.
 *
 * Whatever is found is then normalized to Swarm's own JSON shape: Swarm's JSON passes through,
 * Fooocus JSON and A1111-style "parameters" text are converted, anything else reads as nothing.
 */

/** Text chunk / EXIF keys that may carry the metadata, in the order legacy tries them. */
const METADATA_KEYS = ['parameters', 'Parameters', 'userComment', 'UserComment', 'model', 'Model', 'prompt', 'Prompt'];

const STEALTH_INFO = 'stealth_pnginfo';
const STEALTH_COMP = 'stealth_pngcomp';

const FOOOCUS_KEYS: [string, string][] = [
    ['Prompt', 'prompt'],
    ['Negative', 'negativeprompt'],
    ['cfg', 'cfgscale'],
    ['sampler_name', 'sampler'],
    ['base_model_name', 'model'],
    ['denoise', 'initimagecreativity']
];

/** Inflates zlib (`deflate`) or gzip data with the browser's own decompressor. */
async function inflate(data: Uint8Array, format: 'deflate' | 'gzip'): Promise<Uint8Array> {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function latin1(bytes: Uint8Array): string {
    return new TextDecoder('latin1').decode(bytes);
}

function utf8(bytes: Uint8Array): string {
    return new TextDecoder('utf-8').decode(bytes);
}

/** Index of the next zero byte at or after `from`, or -1. */
function nullAt(bytes: Uint8Array, from: number): number {
    for (let i = from; i < bytes.length; i++) {
        if (bytes[i] === 0) {
            return i;
        }
    }
    return -1;
}

/** Every text chunk in a PNG, keyed by keyword. */
async function pngText(bytes: Uint8Array): Promise<Record<string, string>> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const found: Record<string, string> = {};
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = latin1(bytes.subarray(offset + 4, offset + 8));
        const start = offset + 8;
        const end = start + length;
        if (end > bytes.length || type === 'IEND') {
            break;
        }
        const chunk = bytes.subarray(start, end);
        const keyEnd = nullAt(chunk, 0);
        if (keyEnd > 0) {
            const key = latin1(chunk.subarray(0, keyEnd));
            try {
                if (type === 'tEXt') {
                    found[key] = latin1(chunk.subarray(keyEnd + 1));
                }
                else if (type === 'zTXt') {
                    found[key] = latin1(await inflate(chunk.subarray(keyEnd + 2), 'deflate'));
                }
                else if (type === 'iTXt') {
                    const compressed = chunk[keyEnd + 1] === 1;
                    const langEnd = nullAt(chunk, keyEnd + 3);
                    const translatedEnd = langEnd === -1 ? -1 : nullAt(chunk, langEnd + 1);
                    if (translatedEnd !== -1) {
                        const text = chunk.subarray(translatedEnd + 1);
                        found[key] = utf8(compressed ? await inflate(text, 'deflate') : text);
                    }
                }
            }
            catch {
                // One damaged chunk should not hide the others.
            }
        }
        // Length, type, data, CRC.
        offset = end + 4;
    }
    return found;
}

const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD = 0x8769;
const TAG_USER_COMMENT = 0x9286;

/** UserComment, Model and the like from a TIFF-structured EXIF block. UserComment stays raw bytes,
 *  since its first eight say how the rest is encoded. */
function exifTags(tiff: Uint8Array): Record<string, string | Uint8Array> {
    const found: Record<string, string | Uint8Array> = {};
    if (tiff.length < 8) {
        return found;
    }
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const little = tiff[0] === 0x49;
    const u16 = (at: number) => view.getUint16(at, little);
    const u32 = (at: number) => view.getUint32(at, little);

    /** The bytes of one IFD entry's value, inline or at its offset. */
    function entryBytes(entry: number): Uint8Array | null {
        const type = u16(entry + 2);
        const count = u32(entry + 4);
        const size = (TIFF_TYPE_SIZES[type] ?? 1) * count;
        const at = size <= 4 ? entry + 8 : u32(entry + 8);
        if (at + size > tiff.length) {
            return null;
        }
        return tiff.subarray(at, at + size);
    }

    function readIfd(at: number, depth: number): void {
        if (depth > 2 || at + 2 > tiff.length) {
            return;
        }
        const count = u16(at);
        for (let i = 0; i < count; i++) {
            const entry = at + 2 + i * 12;
            if (entry + 12 > tiff.length) {
                return;
            }
            const tag = u16(entry);
            if (tag === TAG_EXIF_IFD) {
                readIfd(u32(entry + 8), depth + 1);
                continue;
            }
            if (tag !== TAG_USER_COMMENT && tag !== TAG_MODEL) {
                continue;
            }
            const value = entryBytes(entry);
            if (!value) {
                continue;
            }
            if (tag === TAG_USER_COMMENT) {
                found.UserComment = value;
            }
            else {
                found.Model = utf8(value).replace(/\0+$/, '');
            }
        }
    }

    try {
        readIfd(u32(4), 0);
    }
    catch {
        // Truncated EXIF: keep whatever was read before it ran out.
    }
    return found;
}

/** Strips the `Exif\0\0` header that precedes the TIFF block in JPEG APP1 and, often, WebP EXIF. */
function tiffFromExif(block: Uint8Array): Uint8Array {
    if (latin1(block.subarray(0, 6)) === 'Exif\0\0') {
        return block.subarray(6);
    }
    return block;
}

/** The EXIF block of a JPEG (its APP1 segment), or null. */
function jpegExif(bytes: Uint8Array): Uint8Array | null {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            return null;
        }
        const marker = bytes[offset + 1];
        // Start of scan: the image data follows, and no metadata after it.
        if (marker === 0xda || marker === 0xd9) {
            return null;
        }
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        const segment = bytes.subarray(offset + 4, offset + 2 + length);
        if (marker === 0xe1 && latin1(segment.subarray(0, 6)) === 'Exif\0\0') {
            return segment;
        }
        offset += 2 + length;
    }
    return null;
}

/** The EXIF chunk of a WebP, or null. */
function webpExif(bytes: Uint8Array): Uint8Array | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const type = latin1(bytes.subarray(offset, offset + 4));
        const length = view.getUint32(offset + 4, true);
        const start = offset + 8;
        if (type === 'EXIF') {
            return bytes.subarray(start, Math.min(bytes.length, start + length));
        }
        // Chunks are padded to an even length.
        offset = start + length + (length % 2);
    }
    return null;
}

/** Decodes an EXIF UserComment: an 8-byte charset id, then the text. */
function decodeUserComment(bytes: Uint8Array): string {
    const prefix = latin1(bytes.subarray(0, 8));
    const data = bytes.subarray(8);
    if (prefix.startsWith('UNICODE')) {
        // The byte order is not recorded. Legacy's heuristic: a leading zero then a non-zero is
        // big-endian ASCII-range text, which is what nearly every prompt is.
        const bigEndian = data[0] === 0 && data[1] !== 0;
        return new TextDecoder(bigEndian ? 'utf-16be' : 'utf-16le').decode(data);
    }
    return utf8(data);
}

/** Reads metadata hidden in the alpha channel's low bits, column by column, as the
 *  stealth_pnginfo format writes it. Null when the image carries none. */
async function stealthMetadata(blob: Blob): Promise<string | null> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(blob);
    }
    catch {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || bitmap.width === 0 || bitmap.height === 0) {
        bitmap.close();
        return null;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = canvas.width;
    const height = canvas.height;
    const total = width * height;

    /** Bytes `[from, from + count)` of the hidden stream. */
    function readBytes(from: number, count: number): Uint8Array | null {
        if ((from + count) * 8 > total) {
            return null;
        }
        const out = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
            let value = 0;
            for (let bit = 0; bit < 8; bit++) {
                const index = (from + i) * 8 + bit;
                const x = Math.floor(index / height);
                const y = index % height;
                value = (value << 1) | (pixels[(y * width + x) * 4 + 3] & 1);
            }
            out[i] = value;
        }
        return out;
    }

    const header = readBytes(0, STEALTH_INFO.length + 4);
    if (!header) {
        return null;
    }
    const kind = latin1(header.subarray(0, STEALTH_INFO.length));
    if (kind !== STEALTH_INFO && kind !== STEALTH_COMP) {
        return null;
    }
    const bits = new DataView(header.buffer).getUint32(STEALTH_INFO.length);
    const content = readBytes(header.length, Math.floor(bits / 8));
    if (!content) {
        return null;
    }
    return kind === STEALTH_COMP ? utf8(await inflate(content, 'gzip')) : utf8(content);
}

/** Lowercase letters only - how the legacy UI matches a foreign key to a param id. */
function cleanParamName(name: string): string {
    return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** Best-effort conversion of A1111-style `parameters` text, which has no formal grammar. */
function upvertA1111(text: string, knownParams?: ReadonlySet<string>): string {
    const data: Record<string, unknown> = {};
    let rest = text;
    const negativeMarker = '\nNegative prompt: ';
    const negativeAt = rest.indexOf(negativeMarker);
    if (negativeAt !== -1) {
        data.prompt = rest.slice(0, negativeAt);
        const after = rest.slice(negativeAt + negativeMarker.length);
        const lineEnd = after.indexOf('\n');
        data.negativeprompt = lineEnd === -1 ? after : after.slice(0, lineEnd);
        rest = lineEnd === -1 ? '' : after.slice(lineEnd + 1);
    }
    else {
        const lines = rest.split('\n');
        data.prompt = lines.slice(0, -1).join('\n');
        rest = lines[lines.length - 1];
    }
    const lines = rest.split('\n');
    const last = lines[lines.length - 1] ?? '';
    for (const part of last.split(',')) {
        const pieces = part.split(':').map(piece => piece.trim());
        if (pieces.length !== 2) {
            continue;
        }
        const [key, value] = pieces;
        const clean = cleanParamName(key);
        if (knownParams?.has(clean)) {
            data[clean] = value;
        }
        else if (clean === 'size') {
            const size = value.split('x').map(n => parseInt(n, 10));
            if (size.length === 2) {
                data.width = size[0];
                data.height = size[1];
            }
        }
        else if (clean === 'scheduletype') {
            data.scheduler = value.toLowerCase();
        }
        else {
            data[key] = value;
        }
    }
    return JSON.stringify({ sui_image_params: data });
}

/** Normalizes found metadata text to Swarm's JSON format, or null when it is not something
 *  generation parameters can be read from. `knownParams` (param ids) lets A1111 text map its keys
 *  onto real params. Mirrors interpretMetadata (metadatahelpers.js:73). */
export function interpretMetadata(raw: string | null | undefined, knownParams?: ReadonlySet<string>): string | null {
    const text = raw?.trim();
    if (!text) {
        return null;
    }
    if (text.startsWith('{')) {
        let json: unknown;
        try {
            json = JSON.parse(text);
        }
        catch {
            return null;
        }
        if (typeof json !== 'object' || json === null || Array.isArray(json)) {
            return null;
        }
        const record = json as Record<string, unknown>;
        if ('sui_image_params' in record) {
            return text;
        }
        if ('Prompt' in record) {
            for (const [from, to] of FOOOCUS_KEYS) {
                if (from in record) {
                    record[to] = record[from];
                    delete record[from];
                }
            }
            for (const key of Object.keys(record)) {
                if (record[key] === null) {
                    delete record[key];
                }
            }
            return JSON.stringify({ sui_image_params: record });
        }
        return null;
    }
    if (!text.includes('\n')) {
        return null;
    }
    try {
        return upvertA1111(text, knownParams);
    }
    catch {
        return null;
    }
}

/** The raw metadata text embedded in an image file, before any interpretation, or null. */
export async function readEmbeddedMetadataText(blob: Blob): Promise<string | null> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const head = latin1(bytes.subarray(0, 12));
    let tags: Record<string, string | Uint8Array> = {};
    if (head.startsWith('\x89PNG')) {
        tags = await pngText(bytes);
    }
    else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        const exif = jpegExif(bytes);
        tags = exif ? exifTags(tiffFromExif(exif)) : {};
    }
    else if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
        const exif = webpExif(bytes);
        tags = exif ? exifTags(tiffFromExif(exif)) : {};
    }
    for (const key of METADATA_KEYS) {
        const value = tags[key];
        if (value === undefined) {
            continue;
        }
        const text = typeof value === 'string' ? value : decodeUserComment(value);
        if (text.trim()) {
            return text;
        }
    }
    if (blob.type.startsWith('image/') || head.startsWith('\x89PNG') || head.startsWith('RIFF')) {
        try {
            return await stealthMetadata(blob);
        }
        catch {
            return null;
        }
    }
    return null;
}

/** An image file's generation metadata in Swarm's JSON format, or null when it carries none that
 *  is readable. Never throws. */
export async function readImageMetadata(blob: Blob, knownParams?: ReadonlySet<string>): Promise<string | null> {
    try {
        return interpretMetadata(await readEmbeddedMetadataText(blob), knownParams);
    }
    catch {
        return null;
    }
}
