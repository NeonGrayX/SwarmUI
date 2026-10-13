/** The eyedropper. A sub-tool: it has no toolbar button, it borrows control from whichever colour
 *  tool armed it and hands control straight back on release.
 *  Ported from ImageEditorToolPicker (src/wwwroot/js/genpage/helpers/image_editor_tools.js:1315). */

import { Pipette } from 'lucide-react';
import { ColorTool, EditorTool } from './base';
import { hexToGrayscale, rgbToHex } from '../color';
import type { ImageEditorEngine } from '../engine';

export class PickerTool extends EditorTool {
    /** The colour tool this pick is for. */
    toolFor: ColorTool | null = null;
    private picking = false;
    private color = '#ffffff';
    /** The rendered view, read back once when the press starts. Reading the display canvas on
     *  every move forces a GPU readback each time; the view does not change under an eyedropper
     *  drag, so one copy serves the whole press. */
    private view: ImageData | null = null;

    constructor(engine: ImageEditorEngine) {
        super(engine, 'picker', Pipette, 'editor.tool.picker', 'editor.tool.pickerDesc');
        this.isTempTool = true;
        this.cursor = 'none';
    }

    get optionsOwner(): EditorTool {
        return this.toolFor ?? this;
    }

    setInactive(): void {
        super.setInactive();
        this.picking = false;
        this.view = null;
    }

    draw(): void {
        this.drawCircleBrush(this.engine.pointerX, this.engine.pointerY, 2);
    }

    /** Samples the rendered view, so the pick reflects what the user can actually see - including
     *  layer opacity and the mask overlay - rather than one layer's raw pixels. */
    private pickNow(): void {
        const engine = this.engine;
        if (!engine.canvas || !this.toolFor) {
            return;
        }
        if (!this.view || this.view.width !== engine.canvas.width || this.view.height !== engine.canvas.height) {
            this.view = engine.ctx.getImageData(0, 0, engine.canvas.width, engine.canvas.height);
        }
        const x = Math.round(engine.pointerX * engine.devicePixel);
        const y = Math.round(engine.pointerY * engine.devicePixel);
        if (x < 0 || y < 0 || x >= this.view.width || y >= this.view.height) {
            return;
        }
        const index = (y * this.view.width + x) * 4;
        const data = this.view.data;
        const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
        this.color = rgbToHex(r, g, b);
        if (engine.activeLayer?.isMask) {
            this.color = hexToGrayscale(this.color);
        }
        this.toolFor.setColor(this.color);
        engine.redraw();
    }

    onPointerDown(): void {
        if (this.picking || !this.toolFor) {
            return;
        }
        this.picking = true;
        this.view = null;
        this.pickNow();
    }

    onPointerMove(): void {
        if (this.picking && this.engine.pointerDown) {
            this.pickNow();
        }
    }

    onGlobalPointerUp(): boolean {
        if (!this.picking) {
            return false;
        }
        this.picking = false;
        this.view = null;
        const owner = this.toolFor;
        if (owner) {
            owner.setColor(this.color);
            this.engine.activateTool(owner.id);
        }
        return true;
    }
}
