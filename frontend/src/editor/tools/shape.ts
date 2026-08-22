/** The Shape tool: drag out a rectangle or circle, filled or outlined.
 *  Ported from ImageEditorToolShape (src/wwwroot/js/genpage/helpers/image_editor_tools.js:974).
 *
 * The shape is drawn twice: once into a child buffer of the target layer (which is what actually
 * gets committed, in layer pixels) and once directly onto the view (in screen pixels), because a
 * one-pixel outline scaled up by the zoom would otherwise preview as a blurry smear.
 */

import { Shapes } from 'lucide-react';
import { ColorTool } from './base';
import { EditorLayer } from '../layer';
import type { ImageEditorEngine } from '../engine';
import type { ToolOption, ToolOptionValue } from '../types';

type ShapeKind = 'rectangle' | 'circle';

export class ShapeTool extends ColorTool {
    shape: ShapeKind = 'rectangle';
    fill = false;
    strokeWidth = 4;

    private drawing = false;
    private hasDrawn = false;
    private startX = 0;
    private startY = 0;
    private currentX = 0;
    private currentY = 0;
    private buffer: EditorLayer | null = null;

    constructor(engine: ImageEditorEngine) {
        super(engine, 'shape', Shapes, 'editor.tool.shape', 'editor.tool.shapeDesc', '#ff0000', 'x');
    }

    getOptions(): ToolOption[] {
        return [
            this.colorOption(),
            {
                kind: 'select',
                key: 'shape',
                labelKey: 'editor.option.shape',
                value: this.shape,
                choices: [
                    { value: 'rectangle', labelKey: 'editor.option.rectangle' },
                    { value: 'circle', labelKey: 'editor.option.circle' }
                ]
            },
            { kind: 'checkbox', key: 'fill', labelKey: 'editor.option.fill', value: this.fill },
            {
                kind: 'slider',
                key: 'strokeWidth',
                labelKey: 'editor.option.width',
                value: this.strokeWidth,
                min: 1,
                max: 20,
                step: 1,
                // A filled shape has no outline to set a width for.
                disabled: this.fill
            }
        ];
    }

    setOption(key: string, value: ToolOptionValue): void {
        if (key === 'shape') {
            this.shape = value === 'circle' ? 'circle' : 'rectangle';
        }
        else if (key === 'fill') {
            this.fill = Boolean(value);
        }
        else if (key === 'strokeWidth') {
            this.strokeWidth = Number(value);
        }
        else {
            super.setOption(key, value);
            return;
        }
        this.engine.notify();
        this.engine.redraw();
    }

    private get effectiveStrokeWidth(): number {
        return this.fill ? 1 : this.strokeWidth;
    }

    /** A rectangle outline built from four fills, so the corners meet exactly at any thickness. */
    private strokeRectangle(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        width: number,
        height: number,
        thickness: number
    ): void {
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));
        const t = Math.min(Math.max(1, Math.floor(thickness)), w, h);
        ctx.fillRect(x, y, w, t);
        ctx.fillRect(x, y + h - t, w, t);
        const middle = h - t * 2;
        if (middle > 0) {
            ctx.fillRect(x, y + t, t, middle);
            ctx.fillRect(x + w - t, y + t, t, middle);
        }
    }

    /** Draws the shape in whatever coordinate space `ctx` is currently in. */
    private strokeShape(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        width: number,
        height: number,
        thickness: number
    ): void {
        ctx.imageSmoothingEnabled = false;
        ctx.setLineDash([]);
        ctx.fillStyle = this.color;
        if (this.shape === 'rectangle') {
            if (this.fill) {
                ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
            }
            else {
                this.strokeRectangle(ctx, Math.round(x), Math.round(y), width, height, thickness);
            }
            return;
        }
        ctx.strokeStyle = this.color;
        ctx.lineWidth = Math.max(1, Math.round(thickness));
        // The drag rectangle's diagonal is the diameter, so the circle passes through both corners.
        const radius = Math.sqrt(width * width + height * height) / 2;
        ctx.beginPath();
        ctx.arc(Math.round(x + width / 2), Math.round(y + height / 2), Math.round(radius), 0, 2 * Math.PI);
        if (this.fill) {
            ctx.fill();
        }
        ctx.stroke();
    }

    draw(): void {
        const engine = this.engine;
        if (!this.drawing || !engine.activeLayer) {
            return;
        }
        const minX = Math.min(this.startX, this.currentX);
        const minY = Math.min(this.startY, this.currentY);
        const maxX = Math.max(this.startX, this.currentX);
        const maxY = Math.max(this.startY, this.currentY);
        if (maxX === minX && maxY === minY) {
            return;
        }
        const [x1, y1] = engine.imageCoordToCanvasCoord(minX, minY);
        const [x2, y2] = engine.imageCoordToCanvasCoord(maxX, maxY);
        const ctx = engine.ctx;
        ctx.save();
        if (engine.hasSelection) {
            const [sx1, sy1] = engine.imageCoordToCanvasCoord(engine.selectX, engine.selectY);
            const [sx2, sy2] = engine.imageCoordToCanvasCoord(
                engine.selectX + engine.selectWidth,
                engine.selectY + engine.selectHeight
            );
            ctx.beginPath();
            ctx.rect(sx1, sy1, sx2 - sx1, sy2 - sy1);
            ctx.clip();
        }
        this.strokeShape(
            ctx,
            x1,
            y1,
            x2 - x1,
            y2 - y1,
            Math.max(1, Math.round(this.effectiveStrokeWidth * engine.zoomLevel))
        );
        ctx.restore();
    }

    private updateCurrent(): void {
        const [x, y] = this.engine.canvasCoordToImageCoord(this.engine.pointerX, this.engine.pointerY);
        this.currentX = Math.round(x);
        this.currentY = Math.round(y);
    }

    onPointerDown(e: PointerEvent): void {
        if (e.button !== 0) {
            return;
        }
        if (this.drawing) {
            this.finish();
        }
        const target = this.engine.activeLayer;
        if (!target) {
            return;
        }
        const [x, y] = this.engine.canvasCoordToImageCoord(this.engine.pointerX, this.engine.pointerY);
        this.startX = Math.round(x);
        this.startY = Math.round(y);
        this.currentX = this.startX;
        this.currentY = this.startY;
        this.drawing = true;
        this.hasDrawn = false;
        this.buffer = new EditorLayer(this.engine, target.canvas.width, target.canvas.height, target);
        target.childLayers.push(this.buffer);
    }

    // Only the global handler is implemented: it fires for every move, inside the canvas or out,
    // so handling the local one too would just redraw the shape twice per event.
    onGlobalPointerMove(): boolean {
        if (!this.drawing) {
            return false;
        }
        this.updateCurrent();
        this.renderToBuffer();
        return true;
    }

    onGlobalPointerUp(e: PointerEvent): boolean {
        if (e.button !== 0 || !this.drawing) {
            return false;
        }
        this.updateCurrent();
        this.finish();
        return true;
    }

    /** Redraws the in-progress shape into the layer's child buffer, in image coordinates. */
    private renderToBuffer(): void {
        const engine = this.engine;
        const parent = engine.activeLayer;
        if (!this.drawing || !this.buffer || !parent) {
            return;
        }
        const ctx = this.buffer.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.buffer.canvas.width, this.buffer.canvas.height);
        ctx.restore();

        const startX = Math.min(this.startX, this.currentX);
        const startY = Math.min(this.startY, this.currentY);
        const width = Math.max(this.startX, this.currentX) - startX;
        const height = Math.max(this.startY, this.currentY) - startY;
        if (width === 0 && height === 0) {
            this.buffer.hasAnyContent = false;
            this.hasDrawn = false;
            engine.redraw();
            return;
        }

        ctx.save();
        const [offsetX, offsetY] = parent.getOffset();
        parent.setImageSpaceTransform(ctx, offsetX, offsetY);
        if (engine.hasSelection) {
            ctx.beginPath();
            ctx.rect(engine.selectX, engine.selectY, engine.selectWidth, engine.selectHeight);
            ctx.clip();
        }
        this.strokeShape(ctx, startX, startY, width, height, Math.max(1, Math.round(this.effectiveStrokeWidth)));
        ctx.restore();

        this.buffer.hasAnyContent = true;
        this.hasDrawn = true;
        engine.markChanged();
        engine.redraw();
    }

    /** Commits the buffer onto the layer, or discards it if the drag never produced anything. */
    private finish(): void {
        const engine = this.engine;
        const parent = engine.activeLayer;
        const buffer = this.buffer;
        this.drawing = false;
        this.buffer = null;
        if (!buffer || !parent) {
            this.hasDrawn = false;
            engine.redraw();
            return;
        }
        const index = parent.childLayers.indexOf(buffer);
        if (index !== -1) {
            parent.childLayers.splice(index, 1);
        }
        if (this.hasDrawn) {
            const offset = parent.getOffset();
            parent.saveBeforeEdit();
            buffer.drawToBackDirect(parent.ctx, -offset[0], -offset[1], 1);
            parent.hasAnyContent = true;
            engine.markChanged();
        }
        this.hasDrawn = false;
        engine.notify();
        engine.redraw();
    }

    onDocumentReset(): void {
        this.drawing = false;
        this.hasDrawn = false;
        this.buffer = null;
    }
}
