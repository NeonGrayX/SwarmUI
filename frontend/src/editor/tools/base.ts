/** Tool base classes.
 *  Ported from ImageEditorTool / ImageEditorTempTool / ImageEditorToolWithColor
 *  (src/wwwroot/js/genpage/helpers/image_editor_tools.js:5-291).
 *
 *  A tool owns no DOM: it declares its controls with `getOptions()` and takes edits back through
 *  `setOption()`, so the option bar is rendered, themed and translated once for every tool.
 */

import type { LucideIcon } from 'lucide-react';
import type { ImageEditorEngine } from '../engine';
import type { EditorLayer } from '../layer';
import type { LayerState, ToolOption, ToolOptionValue } from '../types';
import { hexToGrayscale } from '../color';

export abstract class EditorTool {
    readonly engine: ImageEditorEngine;
    readonly id: string;
    readonly icon: LucideIcon;
    readonly labelKey: string;
    readonly descriptionKey: string;
    readonly hotkey: string | null;

    /** Sub-tools activate over the top of the current tool and hand control back when done. */
    isTempTool = false;
    /** Hidden from the toolbar unless the active layer is a mask. */
    isMaskOnly = false;
    cursor = 'crosshair';
    active = false;

    constructor(
        engine: ImageEditorEngine,
        id: string,
        icon: LucideIcon,
        labelKey: string,
        descriptionKey: string,
        hotkey: string | null = null
    ) {
        this.engine = engine;
        this.id = id;
        this.icon = icon;
        this.labelKey = labelKey;
        this.descriptionKey = descriptionKey;
        this.hotkey = hotkey;
    }

    /** The tool this one's option bar belongs to. A sub-tool overrides it to point at whichever
     *  tool it is serving, so borrowing control does not blank the bar. */
    get optionsOwner(): EditorTool {
        return this;
    }

    /** Whether the toolbar should leave this tool out right now. */
    get hidden(): boolean {
        if (this.isTempTool) {
            return true;
        }
        return this.isMaskOnly && !this.engine.activeLayer?.isMask;
    }

    setActive(): void {
        this.active = true;
    }

    setInactive(): void {
        this.active = false;
    }

    /** Controls for the option bar. Empty by default. */
    getOptions(): ToolOption[] {
        return [];
    }

    /** Applies an edit from the option bar. */
    setOption(_key: string, _value: ToolOptionValue): void {}

    /** Overlay drawn on top of the composited image each frame. */
    draw(): void {}

    onPointerDown(_e: PointerEvent): void {}
    onPointerUp(_e: PointerEvent): void {}
    /** Pointer moved while over the canvas. */
    onPointerMove(_e: PointerEvent): void {}
    onWheel(_e: WheelEvent): void {}
    /** Pointer moved anywhere, including outside the canvas during a drag.
     *  Return true to request a redraw. */
    onGlobalPointerMove(_e: PointerEvent): boolean {
        return false;
    }
    /** Return true to request a redraw. */
    onGlobalPointerUp(_e: PointerEvent): boolean {
        return false;
    }
    /** Return true to claim the right button; otherwise it falls through to canvas panning. */
    onRightPointerDown(_e: PointerEvent): boolean {
        return false;
    }
    onBeforeHistoryUndo(): void {}

    /** The document was replaced wholesale; drop any state tied to the old one. */
    onDocumentReset(): void {}

    /** Called on every tool when the active layer changes, with what the previously active layer
     *  was, so a tool can compare rather than having to have cached it. Converting a layer between
     *  image and mask reports the same layer's former state, which is why this is a plain
     *  descriptor rather than the layer itself. */
    onLayerChanged(_previous: LayerState | null, newLayer: EditorLayer | null): void {
        if (this.isMaskOnly && this.active && !newLayer?.isMask) {
            this.engine.activateTool('brush');
        }
    }

    /* ---- Shared drawing / selection helpers ---------------------------------------------- */

    /** The brush outline, drawn in difference mode so it stays visible over any colour. */
    protected drawCircleBrush(x: number, y: number, radius: number): void {
        const ctx = this.engine.ctx;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.globalCompositeOperation = 'difference';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
    }

    /** The selection as a quadrilateral in `layer`'s backing pixels, or null if nothing is
     *  selected. A quad rather than a rect because a rotated layer turns the axis-aligned
     *  selection into a parallelogram in its own space. */
    protected getSelectionQuadInLayer(layer: EditorLayer): [number, number][] | null {
        const engine = this.engine;
        if (!engine.hasSelection) {
            return null;
        }
        const x1 = engine.selectX;
        const y1 = engine.selectY;
        const x2 = engine.selectX + engine.selectWidth;
        const y2 = engine.selectY + engine.selectHeight;
        const corners: [number, number][] = [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2]
        ];
        return corners.map(([ix, iy]) => {
            const [cx, cy] = engine.imageCoordToCanvasCoord(ix, iy);
            return layer.canvasCoordToLayerCoord(cx, cy);
        });
    }

    /** Axis-aligned bounds of the selection in `layer`'s backing pixels, or null. */
    protected getSelectionBoundsInLayer(
        layer: EditorLayer
    ): { minX: number; minY: number; maxX: number; maxY: number } | null {
        const quad = this.getSelectionQuadInLayer(layer);
        if (!quad) {
            return null;
        }
        const xs = quad.map(p => p[0]);
        const ys = quad.map(p => p[1]);
        return {
            minX: Math.round(Math.min(...xs)),
            minY: Math.round(Math.min(...ys)),
            maxX: Math.round(Math.max(...xs)),
            maxY: Math.round(Math.max(...ys))
        };
    }

    /** Clips `ctx` to the selection, in `layer`'s backing pixels. No-op without a selection. */
    protected applySelectionClip(ctx: CanvasRenderingContext2D, layer: EditorLayer): void {
        const quad = this.getSelectionQuadInLayer(layer);
        if (!quad) {
            return;
        }
        ctx.beginPath();
        ctx.moveTo(quad[0][0], quad[0][1]);
        for (let i = 1; i < quad.length; i++) {
            ctx.lineTo(quad[i][0], quad[i][1]);
        }
        ctx.closePath();
        ctx.clip();
    }
}

/**
 * Base for tools that paint a colour: the swatch, the eyedropper, and separate colour memory for
 * image and mask layers.
 *
 * The two memories matter because a mask only carries brightness: switching to a mask layer and
 * back would otherwise leave the brush grey, having silently thrown the user's colour away.
 */
export abstract class ColorTool extends EditorTool {
    color: string;
    private imageColor: string;
    private maskColor = '#ffffff';
    /** True while the eyedropper is armed for this tool. */
    picking = false;

    constructor(
        engine: ImageEditorEngine,
        id: string,
        icon: LucideIcon,
        labelKey: string,
        descriptionKey: string,
        defaultColor = '#ffffff',
        hotkey: string | null = null
    ) {
        super(engine, id, icon, labelKey, descriptionKey, hotkey);
        this.color = defaultColor;
        this.imageColor = defaultColor;
    }

    /** Whether the tool is painting onto a mask, and so restricted to greys. */
    protected get onMask(): boolean {
        return this.engine.activeLayer?.isMask === true;
    }

    protected colorOption(): ToolOption {
        return {
            kind: 'color',
            key: 'color',
            labelKey: 'editor.option.color',
            value: this.color,
            grayscale: this.onMask,
            eyedropper: true,
            picking: this.picking
        };
    }

    setColor(color: string): void {
        this.color = this.onMask ? hexToGrayscale(color) : color;
        this.picking = false;
        this.engine.notify();
    }

    setOption(key: string, value: ToolOptionValue): void {
        if (key === 'color') {
            this.setColor(String(value));
        }
        else if (key === 'color:pick') {
            this.picking = !this.picking;
            if (this.picking) {
                this.engine.startEyedropper(this);
            }
            else {
                this.engine.activateTool(this.id);
            }
            this.engine.notify();
        }
    }

    onLayerChanged(previous: LayerState | null, newLayer: EditorLayer | null): void {
        super.onLayerChanged(previous, newLayer);
        if (previous?.isMask) {
            this.maskColor = this.color;
        }
        else if (previous) {
            this.imageColor = this.color;
        }
        this.color = newLayer?.isMask ? hexToGrayscale(this.maskColor) : this.imageColor;
    }
}
