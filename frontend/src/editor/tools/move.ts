/** The Move tool: drags the active layer around.
 *  Ported from ImageEditorToolMove (src/wwwroot/js/genpage/helpers/image_editor_tools.js:537). */

import { Move } from 'lucide-react';
import { EditorTool } from './base';
import type { ImageEditorEngine } from '../engine';

/** Grid the Ctrl key snaps to, in image pixels. */
const SNAP = 32;

export class MoveTool extends EditorTool {
    private startX: number | null = null;
    private startY: number | null = null;
    /** Accumulated unconstrained travel, so releasing Shift mid-drag resumes from the true
     *  position rather than from wherever the constraint had parked the layer. */
    private moveX = 0;
    private moveY = 0;

    constructor(engine: ImageEditorEngine) {
        super(engine, 'move', Move, 'editor.tool.move', 'editor.tool.moveDesc', 'm');
    }

    onPointerDown(): void {
        const layer = this.engine.activeLayer;
        if (!layer) {
            return;
        }
        this.startX = layer.offsetX;
        this.startY = layer.offsetY;
        this.moveX = 0;
        this.moveY = 0;
        layer.savePositions();
    }

    onGlobalPointerMove(e: PointerEvent): boolean {
        const engine = this.engine;
        const layer = engine.activeLayer;
        if (!engine.pointerDown || this.startX === null || this.startY === null || !layer) {
            return false;
        }
        this.moveX += (engine.pointerX - engine.lastPointerX) / engine.zoomLevel;
        this.moveY += (engine.pointerY - engine.lastPointerY) / engine.zoomLevel;
        let actualX = this.moveX;
        let actualY = this.moveY;

        // Shift locks to the nearest of horizontal, vertical or a 45 degree diagonal.
        if (e.shiftKey) {
            const absX = Math.abs(actualX);
            const absY = Math.abs(actualY);
            if (absX > absY * 2) {
                actualY = 0;
            }
            else if (absY > absX * 2) {
                actualX = 0;
            }
            else {
                const distance = Math.sqrt(actualX * actualX + actualY * actualY);
                actualX = distance * Math.sign(actualX);
                actualY = distance * Math.sign(actualY);
            }
        }

        layer.offsetX = this.startX + actualX;
        layer.offsetY = this.startY + actualY;
        if (e.ctrlKey) {
            layer.offsetX = Math.round(layer.offsetX / SNAP) * SNAP;
            layer.offsetY = Math.round(layer.offsetY / SNAP) * SNAP;
        }
        engine.markChanged();
        return true;
    }

    onGlobalPointerUp(): boolean {
        this.startX = null;
        this.startY = null;
        return false;
    }
}
