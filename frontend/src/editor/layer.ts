/** A single layer of the image editor.
 *
 * Direct port of ImageEditorLayer (src/wwwroot/js/genpage/helpers/image_editor.js:6). A layer is a
 * backing canvas at its own native resolution, placed into image space by an offset, a display
 * size and a rotation - so scaling a layer never resamples its pixels until it is exported.
 *
 * `childLayers` are live buffers: while a stroke is in progress the brush draws into a child, so
 * the stroke composites as one object (its opacity applies to the stroke, not to each dab) and can
 * be discarded without touching the layer underneath.
 */

import type { ImageEditorEngine } from './engine';
import { HistoryEntry } from './history';

export class EditorLayer {
    readonly engine: ImageEditorEngine;
    /** Set for buffer layers, whose offsets are relative to the layer they are drawn into. */
    parent: EditorLayer | null;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    /** Assigned by `ImageEditorEngine.addLayer`. Buffer layers keep -1. */
    id = -1;
    /** Display size in image space, which may differ from the backing canvas resolution. */
    width: number;
    height: number;
    offsetX = 0;
    offsetY = 0;
    /** Radians. */
    rotation = 0;
    opacity = 1;
    globalCompositeOperation: GlobalCompositeOperation = 'source-over';
    childLayers: EditorLayer[] = [];
    /** Composited copy of this layer plus its children, rebuilt per frame while children exist. */
    private buffer: EditorLayer | null = null;
    isMask = false;
    /** False for a layer that has never been drawn on, which the mask export treats as absent. */
    hasAnyContent = false;

    constructor(engine: ImageEditorEngine, width: number, height: number, parent: EditorLayer | null = null) {
        this.engine = engine;
        this.parent = parent;
        this.width = width;
        this.height = height;
        this.canvas = document.createElement('canvas');
        this.canvas.width = Math.max(1, Math.round(width));
        this.canvas.height = Math.max(1, Math.round(height));
        this.ctx = this.canvas.getContext('2d')!;
    }

    /** Offset in image space, accumulated through any parent buffers. */
    getOffset(): [number, number] {
        let x = 0;
        let y = 0;
        let node: EditorLayer | null = this;
        while (node) {
            x += node.offsetX;
            y += node.offsetY;
            node = node.parent;
        }
        return [Math.round(x), Math.round(y)];
    }

    /** Detached copy of this layer's current pixels. */
    private snapshot(): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        canvas.getContext('2d')!.drawImage(this.canvas, 0, 0);
        return canvas;
    }

    /** Resamples the backing canvas to a new pixel resolution.
     *  The canvas *element* is reused rather than replaced, because the layer panel shows it live
     *  as the layer's thumbnail - a swapped element would leave a frozen preview behind. */
    resize(width: number, height: number): void {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        const old = this.snapshot();
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.drawImage(old, 0, 0, w, h);
        this.width = w;
        this.height = h;
    }

    /** Inverts the layer's pixels - "Invert Colors" on an image layer, "Invert Mask" on a mask.
     *
     *  Alpha is left alone, as it is in the legacy editor: on a mask, an area nobody painted is
     *  not a masked area waiting to be flipped, it is an area with no mask at all. */
    invert(): void {
        this.saveBeforeEdit();
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];
            data[i + 1] = 255 - data[i + 1];
            data[i + 2] = 255 - data[i + 2];
        }
        this.ctx.putImageData(imageData, 0, 0);
        this.engine.markChanged();
        this.engine.redraw();
    }

    /* ---- Coordinate mapping ------------------------------------------------------------- */

    /** Screen pixel -> this layer's backing pixel, undoing the layer's rotation and scale. */
    canvasCoordToLayerCoord(x: number, y: number): [number, number] {
        let [px, py] = this.engine.canvasCoordToImageCoord(x, y);
        const [offsetX, offsetY] = this.getOffset();
        const relWidth = this.width / this.canvas.width;
        const relHeight = this.height / this.canvas.height;
        px -= offsetX;
        py -= offsetY;
        const angle = -this.rotation;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const dx = px - cx;
        const dy = py - cy;
        px = dx * Math.cos(angle) - dy * Math.sin(angle) + cx;
        py = dx * Math.sin(angle) + dy * Math.cos(angle) + cy;
        return [px / relWidth, py / relHeight];
    }

    /** This layer's backing pixel -> screen pixel. */
    layerCoordToCanvasCoord(x: number, y: number): [number, number] {
        const [offsetX, offsetY] = this.getOffset();
        const relWidth = this.width / this.canvas.width;
        const relHeight = this.height / this.canvas.height;
        const px = x * relWidth;
        const py = y * relHeight;
        const angle = this.rotation;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const dx = px - cx;
        const dy = py - cy;
        const rx = dx * Math.cos(angle) - dy * Math.sin(angle) + cx + offsetX;
        const ry = dx * Math.sin(angle) + dy * Math.cos(angle) + cy + offsetY;
        return this.engine.imageCoordToCanvasCoord(rx, ry);
    }

    /** Sets `ctx` up so that drawing in *image* coordinates lands correctly on this layer's
     *  backing pixels. Pass the layer's own offset to draw content positioned in image space, or
     *  (0, 0) when the caller has already translated by it. */
    setImageSpaceTransform(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
        const relWidth = this.width / this.canvas.width;
        const relHeight = this.height / this.canvas.height;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const cosR = Math.cos(-this.rotation);
        const sinR = Math.sin(-this.rotation);
        ctx.setTransform(
            cosR / relWidth,
            sinR / relHeight,
            -sinR / relWidth,
            cosR / relHeight,
            (-cosR * (offsetX + cx) + sinR * (offsetY + cy) + cx) / relWidth,
            (-sinR * (offsetX + cx) - cosR * (offsetY + cy) + cy) / relHeight
        );
    }

    /* ---- Drawing primitives ------------------------------------------------------------- */

    drawFilledCircle(x: number, y: number, radius: number, color: string): void {
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
        this.ctx.fill();
    }

    /** The quad joining two circles of the same radius, so a dragged brush leaves a solid stroke
     *  rather than a dotted line at high pointer speeds. */
    drawFilledCircleStrokeBetween(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        radius: number,
        color: string
    ): void {
        const angle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
        const rx = radius * Math.cos(angle);
        const ry = radius * Math.sin(angle);
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(x1 + rx, y1 + ry);
        this.ctx.lineTo(x2 + rx, y2 + ry);
        this.ctx.lineTo(x2 - rx, y2 - ry);
        this.ctx.lineTo(x1 - rx, y1 - ry);
        this.ctx.closePath();
        this.ctx.fill();
    }

    /** Draws this layer's own pixels into `ctx`, ignoring any children. */
    drawToBackDirect(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, zoom: number): void {
        ctx.save();
        const [thisOffsetX, thisOffsetY] = this.getOffset();
        const x = offsetX + thisOffsetX;
        const y = offsetY + thisOffsetY;
        ctx.globalAlpha = this.opacity;
        ctx.globalCompositeOperation = this.globalCompositeOperation;
        const cx = this.width / 2;
        const cy = this.height / 2;
        ctx.translate((x + cx) * zoom, (y + cy) * zoom);
        ctx.rotate(this.rotation);
        // Past this zoom a pixel is a visible block, and smoothing it just makes it a blurry block.
        if (zoom > 5) {
            ctx.imageSmoothingEnabled = false;
        }
        ctx.drawImage(this.canvas, -cx * zoom, -cy * zoom, this.width * zoom, this.height * zoom);
        ctx.restore();
    }

    /** Draws this layer and any in-progress child buffers as one composited object. */
    drawToBack(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, zoom: number): void {
        if (this.childLayers.length === 0) {
            this.buffer = null;
            this.drawToBackDirect(ctx, offsetX, offsetY, zoom);
            return;
        }
        if (this.buffer === null) {
            this.buffer = new EditorLayer(this.engine, this.canvas.width, this.canvas.height);
            this.buffer.width = this.width;
            this.buffer.height = this.height;
            this.buffer.rotation = this.rotation;
        }
        const offset = this.getOffset();
        this.buffer.offsetX = this.offsetX;
        this.buffer.offsetY = this.offsetY;
        this.buffer.opacity = this.opacity;
        this.buffer.globalCompositeOperation = this.globalCompositeOperation;
        this.buffer.ctx.globalAlpha = 1;
        this.buffer.ctx.globalCompositeOperation = 'source-over';
        this.buffer.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.buffer.ctx.drawImage(this.canvas, 0, 0);
        for (const child of this.childLayers) {
            child.drawToBack(this.buffer.ctx, -offset[0], -offset[1], 1);
        }
        this.buffer.drawToBackDirect(ctx, offsetX, offsetY, zoom);
    }

    /* ---- Content edits ------------------------------------------------------------------ */

    /** Saves undo state, clears all content, and marks the layer as empty. */
    clearToEmpty(): void {
        this.saveBeforeEdit();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hasAnyContent = false;
    }

    /** Replaces this mask layer's content with `img`, treating near-black as transparent.
     *  Used by the SAM2 tools, whose results arrive as a black/white image in image space. */
    applyMaskFromImage(img: CanvasImageSource): void {
        this.saveBeforeEdit();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        let imageData: ImageData;
        if (this.rotation === 0) {
            const [offsetX, offsetY] = this.getOffset();
            this.ctx.drawImage(
                img,
                offsetX,
                offsetY,
                this.width,
                this.height,
                0,
                0,
                this.canvas.width,
                this.canvas.height
            );
            imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        }
        else {
            const temp = document.createElement('canvas');
            temp.width = this.canvas.width;
            temp.height = this.canvas.height;
            const tempCtx = temp.getContext('2d')!;
            const [offsetX, offsetY] = this.getOffset();
            this.setImageSpaceTransform(tempCtx, offsetX, offsetY);
            tempCtx.drawImage(
                img,
                0,
                0,
                (img as HTMLCanvasElement).width || this.engine.realWidth,
                (img as HTMLCanvasElement).height || this.engine.realHeight,
                0,
                0,
                this.engine.realWidth,
                this.engine.realHeight
            );
            imageData = tempCtx.getImageData(0, 0, temp.width, temp.height);
        }
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] + data[i + 1] + data[i + 2] < 128) {
                data[i + 3] = 0;
            }
        }
        this.ctx.putImageData(imageData, 0, 0);
        this.hasAnyContent = true;
    }

    /* ---- Undo ---------------------------------------------------------------------------- */

    /** Records the layer's pixels and placement, before an edit that changes either. */
    saveBeforeEdit(): void {
        this.engine.addHistoryEntry(
            new HistoryEntry(this.engine, 'layer_canvas_edit', {
                layer: this,
                oldCanvas: this.snapshot(),
                oldOffsetX: this.offsetX,
                oldOffsetY: this.offsetY,
                oldRotation: this.rotation,
                oldWidth: this.width,
                oldHeight: this.height
            })
        );
    }

    /** Records only the layer's placement, before a move/resize/rotate. */
    savePositions(): void {
        this.engine.addHistoryEntry(
            new HistoryEntry(this.engine, 'layer_reposition', {
                layer: this,
                oldOffsetX: this.offsetX,
                oldOffsetY: this.offsetY,
                oldRotation: this.rotation,
                oldWidth: this.width,
                oldHeight: this.height
            })
        );
    }
}
