/** The Paint Bucket: a threshold flood fill.
 *  Ported from ImageEditorToolBucket (src/wwwroot/js/genpage/helpers/image_editor_tools.js:816).
 *
 * The fill *reads* from a composite of every image layer up to and including the active one, but
 * *writes* only into the active layer - so clicking a region of the picture fills that region even
 * when the layer being painted is empty, which is what makes bucket-fill on a fresh layer useful.
 */

import { PaintBucket } from 'lucide-react';
import { ColorTool } from './base';
import { hexToRgb } from '../color';
import type { ImageEditorEngine } from '../engine';
import type { ToolOption, ToolOptionValue } from '../types';

export class BucketTool extends ColorTool {
    threshold = 10;

    constructor(engine: ImageEditorEngine) {
        super(
            engine,
            'paintbucket',
            PaintBucket,
            'editor.tool.bucket',
            'editor.tool.bucketDesc',
            '#ffffff',
            'p'
        );
    }

    getOptions(): ToolOption[] {
        return [
            this.colorOption(),
            {
                kind: 'slider',
                key: 'threshold',
                labelKey: 'editor.option.threshold',
                value: this.threshold,
                min: 1,
                max: 256,
                step: 1
            }
        ];
    }

    setOption(key: string, value: ToolOptionValue): void {
        if (key === 'threshold') {
            this.threshold = Number(value);
            this.engine.notify();
            this.engine.redraw();
        }
        else {
            super.setOption(key, value);
        }
    }

    onPointerDown(e: PointerEvent): void {
        if (e.button === 0) {
            this.fill(this.engine.pointerX, this.engine.pointerY);
        }
    }

    private fill(canvasX: number, canvasY: number): void {
        const engine = this.engine;
        const layer = engine.activeLayer;
        if (!layer) {
            return;
        }
        const [rawX, rawY] = layer.canvasCoordToLayerCoord(canvasX, canvasY);
        const targetX = Math.round(rawX);
        const targetY = Math.round(rawY);
        if (targetX < 0 || targetY < 0 || targetX >= layer.canvas.width || targetY >= layer.canvas.height) {
            return;
        }
        const selBounds = this.getSelectionBoundsInLayer(layer);
        if (
            selBounds &&
            (targetX < selBounds.minX ||
                targetY < selBounds.minY ||
                targetX >= selBounds.maxX ||
                targetY >= selBounds.maxY)
        ) {
            return;
        }

        // Reference: everything visible at or below the active layer, rendered into this layer's
        // own pixel grid so a rotated or scaled layer still samples the right colours.
        const reference = document.createElement('canvas');
        reference.width = layer.canvas.width;
        reference.height = layer.canvas.height;
        const refCtx = reference.getContext('2d')!;
        const offset = layer.getOffset();
        layer.setImageSpaceTransform(refCtx, 0, 0);
        for (const below of engine.layers) {
            if (below.isMask) {
                continue;
            }
            below.drawToBack(refCtx, -offset[0], -offset[1], 1);
            if (below === layer) {
                break;
            }
        }
        refCtx.setTransform(1, 0, 0, 1, 0, 0);
        const refData = refCtx.getImageData(0, 0, reference.width, reference.height).data;

        layer.saveBeforeEdit();
        layer.hasAnyContent = true;
        const imageData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        const width = imageData.width;
        const height = imageData.height;
        const rawData = imageData.data;
        const filled = new Uint8Array(width * height);
        const threshold = this.threshold;
        const newColor = hexToRgb(this.color);

        const boundsMinX = selBounds ? Math.max(0, selBounds.minX) : 0;
        const boundsMinY = selBounds ? Math.max(0, selBounds.minY) : 0;
        const boundsMaxX = selBounds ? Math.min(selBounds.maxX, width) : width;
        const boundsMaxY = selBounds ? Math.min(selBounds.maxY, height) : height;

        // A rotated layer's selection is a parallelogram in layer space, so the axis-aligned
        // bounds above are only a fast reject; each candidate is also tested in image space.
        const hasSelection = engine.hasSelection;
        const relWidth = layer.width / width;
        const relHeight = layer.height / height;
        const centerX = layer.width / 2;
        const centerY = layer.height / 2;
        const cosR = Math.cos(layer.rotation);
        const sinR = Math.sin(layer.rotation);
        const selectX = engine.selectX;
        const selectY = engine.selectY;
        const selectW = engine.selectWidth;
        const selectH = engine.selectHeight;

        const insideSelection = (x: number, y: number): boolean => {
            const dx = x * relWidth - centerX;
            const dy = y * relHeight - centerY;
            const ix = dx * cosR - dy * sinR + centerX + offset[0];
            const iy = dx * sinR + dy * cosR + centerY + offset[1];
            return ix >= selectX && iy >= selectY && ix < selectX + selectW && iy < selectY + selectH;
        };

        const startIndex = (targetY * width + targetX) * 4;
        const start = [
            refData[startIndex],
            refData[startIndex + 1],
            refData[startIndex + 2],
            refData[startIndex + 3]
        ];

        const canInclude = (x: number, y: number): boolean => {
            if (x < boundsMinX || y < boundsMinY || x >= boundsMaxX || y >= boundsMaxY) {
                return false;
            }
            if (filled[y * width + x] !== 0) {
                return false;
            }
            if (hasSelection && !insideSelection(x, y)) {
                return false;
            }
            const index = (y * width + x) * 4;
            const distance =
                Math.abs(refData[index] - start[0]) +
                Math.abs(refData[index + 1] - start[1]) +
                Math.abs(refData[index + 2] - start[2]) +
                Math.abs(refData[index + 3] - start[3]);
            return distance <= threshold;
        };

        const stack: [number, number][] = [[targetX, targetY]];
        while (stack.length > 0) {
            const [x, y] = stack.pop()!;
            if (!canInclude(x, y)) {
                continue;
            }
            filled[y * width + x] = 1;
            const index = (y * width + x) * 4;
            rawData[index] = newColor.r;
            rawData[index + 1] = newColor.g;
            rawData[index + 2] = newColor.b;
            rawData[index + 3] = 255;
            stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
        }

        layer.ctx.save();
        layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
        layer.ctx.putImageData(imageData, 0, 0);
        layer.ctx.restore();
        engine.markChanged();
        engine.notify();
        engine.redraw();
    }
}
