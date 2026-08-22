/** Colour conversions for the image editor.
 *
 * Ported from the arithmetic in src/wwwroot/js/genpage/helpers/color_picker.js; the picker UI
 * itself is react-colorful, so only the conversions that the editor's own logic needs live here.
 */

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex: string): Rgb {
    const clean = hex.replace('#', '');
    const full =
        clean.length === 3
            ? clean
                  .split('')
                  .map(c => c + c)
                  .join('')
            : clean.padEnd(6, '0').slice(0, 6);
    return {
        r: parseInt(full.slice(0, 2), 16) || 0,
        g: parseInt(full.slice(2, 4), 16) || 0,
        b: parseInt(full.slice(4, 6), 16) || 0
    };
}

export function rgbToHex(r: number, g: number, b: number): string {
    const part = (n: number) => clampByte(n).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
}

/** Rec. 601 luma, matching colorPickerHelper.hexToGrayscale. Mask layers only carry brightness,
 *  so a colour picked for one is compressed rather than silently reinterpreted. */
export function hexToGrayscale(hex: string): string {
    const { r, g, b } = hexToRgb(hex);
    const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    return rgbToHex(gray, gray, gray);
}

/** The 0..255 brightness of a grayscale hex, for the mask-mode brightness slider. */
export function hexToLevel(hex: string): number {
    return hexToRgb(hex).r;
}

export function levelToHex(level: number): string {
    return rgbToHex(level, level, level);
}

/** Blends two hex colours, `fraction` of `a` into `b`.
 *  Done in JS rather than with a CSS `color-mix()` string, because Canvas2D colour parsing only
 *  gained `color-mix` support recently and this runs in the render loop. */
export function mixHex(a: string, b: string, fraction: number): string {
    const weight = Math.max(0, Math.min(1, fraction));
    const from = hexToRgb(a);
    const to = hexToRgb(b);
    return rgbToHex(
        from.r * weight + to.r * (1 - weight),
        from.g * weight + to.g * (1 - weight),
        from.b * weight + to.b * (1 - weight)
    );
}
