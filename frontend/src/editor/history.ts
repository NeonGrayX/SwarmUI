/** Undo entries for the image editor.
 *  Ported from ImageEditorHistoryEntry (src/wwwroot/js/genpage/helpers/image_editor.js:290).
 *
 *  The stack is bounded (`maxHistory`), because every `layer_canvas_edit` entry holds a
 *  full-resolution copy of a layer.
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
    /** Present on `layer_canvas_edit`: whether the layer counted as drawn on before the edit. The
     *  mask export skips a mask layer without content, so this has to travel with the pixels. */
    oldHasAnyContent?: boolean;
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

    /** The layer's placement as it is right now, in the shape an entry stores it. */
    private currentPlacement(): Placement {
        const { layer } = this.data;
        return {
            oldOffsetX: layer.offsetX,
            oldOffsetY: layer.offsetY,
            oldRotation: layer.rotation,
            oldWidth: layer.width,
            oldHeight: layer.height
        };
    }

    /** Reverts this entry, and returns the entry that would put the change back - which is what
     *  redo is: undoing the undo. Null when there was nothing to revert. */
    undo(): HistoryEntry | null {
        const { layer } = this.data;
        let inverse: HistoryEntry | null = null;
        if (this.type === 'layer_canvas_edit' && this.data.oldCanvas) {
            const current = document.createElement('canvas');
            current.width = layer.canvas.width;
            current.height = layer.canvas.height;
            current.getContext('2d')!.drawImage(layer.canvas, 0, 0);
            inverse = new HistoryEntry(this.engine, 'layer_canvas_edit', {
                layer,
                oldCanvas: current,
                oldHasAnyContent: layer.hasAnyContent,
                ...this.currentPlacement()
            });
            const ctx = layer.ctx;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'copy';
            ctx.drawImage(this.data.oldCanvas, 0, 0);
            ctx.restore();
            this.restorePlacement();
            if (this.data.oldHasAnyContent !== undefined) {
                layer.hasAnyContent = this.data.oldHasAnyContent;
            }
        }
        else if (this.type === 'layer_reposition') {
            inverse = new HistoryEntry(this.engine, 'layer_reposition', { layer, ...this.currentPlacement() });
            this.restorePlacement();
        }
        else if (this.type === 'layer_add' && this.engine.layers.includes(layer)) {
            const index = this.engine.layers.indexOf(layer);
            this.engine.removeLayer(layer, true);
            inverse = new HistoryEntry(this.engine, 'layer_remove', { layer, index });
        }
        else if (this.type === 'layer_remove') {
            this.engine.addLayer(layer, true, this.data.index);
            inverse = new HistoryEntry(this.engine, 'layer_add', { layer });
        }
        this.data.onUndo?.();
        return inverse;
    }
}
