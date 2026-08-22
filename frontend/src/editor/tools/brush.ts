/** The Paintbrush, and the Eraser built from it.
 *  Ported from ImageEditorToolBrush (src/wwwroot/js/genpage/helpers/image_editor_tools.js:676).
 *
 * A stroke is painted into a child buffer of the target layer rather than onto the layer itself,
 * so the whole stroke composites once: opacity applies to the stroke, not to every overlapping
 * dab within it, and an eraser stroke can subtract cleanly.
 */

import { Eraser, Paintbrush } from 'lucide-react';
import { ColorTool } from './base';
import { EditorLayer } from '../layer';
import type { ImageEditorEngine } from '../engine';
import { pressureOf, type ToolOption, type ToolOptionValue } from '../types';

const MIN_RADIUS = 1;
const MAX_RADIUS = 1024;

export class BrushTool extends ColorTool {
    radius = 10;
    opacity = 1;
    private readonly isEraser: boolean;
    private brushing = false;
    private buffer: EditorLayer | null = null;

    constructor(engine: ImageEditorEngine, isEraser: boolean) {
        super(
            engine,
            isEraser ? 'eraser' : 'brush',
            isEraser ? Eraser : Paintbrush,
            isEraser ? 'editor.tool.eraser' : 'editor.tool.brush',
            isEraser ? 'editor.tool.eraserDesc' : 'editor.tool.brushDesc',
            '#ffffff',
            isEraser ? 'e' : 'b'
        );
        this.isEraser = isEraser;
        // The brush preview circle *is* the cursor.
        this.cursor = 'none';
    }

    getOptions(): ToolOption[] {
        const options: ToolOption[] = [];
        if (!this.isEraser) {
            options.push(this.colorOption());
        }
        options.push(
            {
                kind: 'slider',
                key: 'radius',
                labelKey: 'editor.option.radius',
                value: this.radius,
                min: MIN_RADIUS,
                max: MAX_RADIUS,
                step: 1
            },
            {
                kind: 'slider',
                key: 'opacity',
                labelKey: 'editor.option.opacity',
                value: Math.round(this.opacity * 100),
                min: 1,
                max: 100,
                step: 1,
                unit: '%'
            }
        );
        return options;
    }

    setOption(key: string, value: ToolOptionValue): void {
        if (key === 'radius') {
            this.setRadius(Number(value));
        }
        else if (key === 'opacity') {
            this.opacity = Number(value) / 100;
            this.engine.notify();
            this.engine.redraw();
        }
        else {
            super.setOption(key, value);
        }
    }

    private setRadius(radius: number): void {
        this.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(radius)));
        this.engine.notify();
        this.engine.redraw();
    }

    draw(): void {
        this.drawCircleBrush(this.engine.pointerX, this.engine.pointerY, this.radius * this.engine.zoomLevel);
    }

    /** Ctrl+wheel resizes the brush instead of zooming - the standard painting-app gesture. */
    onWheel(e: WheelEvent): void {
        if (!e.ctrlKey) {
            return;
        }
        e.preventDefault();
        let next = Math.trunc(this.radius * Math.pow(1.1, -e.deltaY / 100));
        if (next === this.radius) {
            // Below ~10px the multiplier rounds to no change at all, so step by one.
            next += e.deltaY > 0 ? -1 : 1;
        }
        this.setRadius(next);
    }

    /** Lays down one dab, joined to the previous position so fast strokes stay solid. */
    private brush(force: number): void {
        const layer = this.engine.activeLayer;
        if (!this.buffer || !layer) {
            return;
        }
        const [lastX, lastY] = layer.canvasCoordToLayerCoord(this.engine.lastPointerX, this.engine.lastPointerY);
        const [x, y] = layer.canvasCoordToLayerCoord(this.engine.pointerX, this.engine.pointerY);
        const radius = this.radius * force;
        this.buffer.drawFilledCircle(lastX, lastY, radius, this.color);
        this.buffer.drawFilledCircleStrokeBetween(lastX, lastY, x, y, radius, this.color);
        this.buffer.drawFilledCircle(x, y, radius, this.color);
        this.engine.markChanged();
    }

    onPointerDown(e: PointerEvent): void {
        const target = this.engine.activeLayer;
        if (this.brushing || !target || e.button !== 0) {
            return;
        }
        this.brushing = true;
        this.buffer = new EditorLayer(this.engine, target.canvas.width, target.canvas.height, target);
        this.buffer.opacity = this.opacity;
        if (this.isEraser) {
            this.buffer.globalCompositeOperation = 'destination-out';
        }
        this.applySelectionClip(this.buffer.ctx, target);
        target.childLayers.push(this.buffer);
        this.brush(pressureOf(e));
    }

    onPointerMove(e: PointerEvent): void {
        if (this.brushing) {
            this.brush(pressureOf(e));
        }
    }

    onGlobalPointerUp(): boolean {
        const target = this.engine.activeLayer;
        if (!this.brushing) {
            return false;
        }
        this.brushing = false;
        if (target && this.buffer) {
            const index = target.childLayers.indexOf(this.buffer);
            if (index !== -1) {
                target.childLayers.splice(index, 1);
            }
            const offset = target.getOffset();
            target.saveBeforeEdit();
            this.buffer.drawToBackDirect(target.ctx, -offset[0], -offset[1], 1);
            target.hasAnyContent = true;
        }
        this.buffer = null;
        this.engine.notify();
        return true;
    }
}
