/** Undo entries for the image editor.
 *
 * Ported from ImageEditorHistoryEntry (src/wwwroot/js/genpage/helpers/image_editor.js:290). The
 * stack is bounded (`maxHistory`), because entries of the `layer_canvas_edit` kind each hold a
 * full-resolution copy of a layer.
 */

import type { ImageEditorEngine } from './engine';
import type { EditorLayer } from './layer';

interface Placement {
    oldOffsetX: number;
    oldOffsetY: number;
    oldRotation: number;
    oldWidth: number;
    oldHeight: number;
}

export interface HistoryData extends Partial<Placement> {
    layer: EditorLayer;
    /** Present on `layer_canvas_edit`: the layer's pixels before the edit. */
    oldCanvas?: HTMLCanvasElement;
    /** Index the layer sat at, for `layer_remove`. */
    index?: number;
    /** Extra restoration a tool attached to this entry - the SAM2 point tool uses it to put its
     *  points back in step with the mask an undo just reverted. */
    onUndo?: () => void;
}

export type HistoryType = 'layer_canvas_edit' | 'layer_reposition' | 'layer_add' | 'layer_remove';

export class HistoryEntry {
    readonly engine: ImageEditorEngine;
    readonly type: HistoryType;
    readonly data: HistoryData;

    constructor(engine: ImageEditorEngine, type: HistoryType, data: HistoryData) {
        this.engine = engine;
        this.type = type;
        this.data = data;
    }

    private restorePlacement(): void {
        const { layer } = this.data;
        layer.offsetX = this.data.oldOffsetX ?? layer.offsetX;
        layer.offsetY = this.data.oldOffsetY ?? layer.offsetY;
        layer.rotation = this.data.oldRotation ?? layer.rotation;
        layer.width = this.data.oldWidth ?? layer.width;
        layer.height = this.data.oldHeight ?? layer.height;
    }

    undo(): void {
        if (this.type === 'layer_canvas_edit' && this.data.oldCanvas) {
            const ctx = this.data.layer.ctx;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'copy';
            ctx.drawImage(this.data.oldCanvas, 0, 0);
            ctx.restore();
            this.restorePlacement();
        }
        else if (this.type === 'layer_reposition') {
            this.restorePlacement();
        }
        else if (this.type === 'layer_add' && this.engine.layers.includes(this.data.layer)) {
            this.engine.removeLayer(this.data.layer, true);
        }
        else if (this.type === 'layer_remove') {
            this.engine.addLayer(this.data.layer, true, this.data.index);
        }
        this.data.onUndo?.();
    }
}
