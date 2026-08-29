/** Shared types for the image editor.
 *
 * A tool owns no DOM: it *describes* its controls as `ToolOption[]` and React renders them, which
 * is what makes every tool's controls themeable, translatable and keyboard-accessible without each
 * tool having to arrange for that itself.
 */

import type { LucideIcon } from 'lucide-react';

/** One control in a tool's option bar. `key` is passed back to `Tool.setOption`. */
export type ToolOption =
    | {
          kind: 'color';
          key: string;
          labelKey: string;
          value: string;
          /** Mask layers carry brightness only, so the picker offers a grey ramp instead of hues. */
          grayscale: boolean;
          /** Whether the eyedropper button is shown, and whether it is currently armed. */
          eyedropper: boolean;
          picking: boolean;
      }
    | {
          kind: 'slider';
          key: string;
          labelKey: string;
          value: number;
          min: number;
          max: number;
          step: number;
          /** Appended to the numeric readout, eg '%'. */
          unit?: string;
          disabled?: boolean;
      }
    | {
          kind: 'select';
          key: string;
          labelKey: string;
          value: string;
          choices: { value: string; labelKey: string }[];
      }
    | { kind: 'checkbox'; key: string; labelKey: string; value: boolean }
    | { kind: 'button'; key: string; labelKey: string; disabled?: boolean }
    | { kind: 'note'; key: string; labelKey: string };

export type ToolOptionValue = string | number | boolean;

/** The part of a layer's identity that a tool reacts to when the active layer changes.
 *  Kept minimal so that converting a layer between image and mask can report the layer's former
 *  state without having to fabricate a whole layer object. */
export interface LayerState {
    isMask: boolean;
}

/** What a tool needs to render its toolbar button. */
export interface ToolInfo {
    id: string;
    icon: LucideIcon;
    /** Translation identifier for the tool's name. */
    labelKey: string;
    /** Translation identifier for the hover description. */
    descriptionKey: string;
    /** Single-key shortcut, or null. */
    hotkey: string | null;
    /** Hidden from the toolbar - either a sub-tool, or a mask-only tool on an image layer. */
    hidden: boolean;
}

/** How a mask is combined with the image at generation time, matching the legacy export. */
export interface EditorExport {
    /** The composited image layers, cropped to the output rect. */
    initImage: string;
    /** Black/white mask over the same rect. */
    maskImage: string;
    width: number;
    height: number;
}

/** A pointer's writing pressure, 1 for devices that do not report it. Pointer events deliver one
 *  stream for pen, touch and mouse alike, so there is nothing to de-duplicate. */
export function pressureOf(e: PointerEvent): number {
    if (e.pointerType === 'mouse' || !e.pressure) {
        return 1;
    }
    return e.pressure;
}
