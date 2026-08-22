/** The Select tool: drags out the rectangle that clips every other tool.
 *  Ported from ImageEditorToolSelect (src/wwwroot/js/genpage/helpers/image_editor_tools.js:594). */

import { SquareDashed } from 'lucide-react';
import { EditorTool } from './base';
import type { ImageEditorEngine } from '../engine';
import type { ToolOption, ToolOptionValue } from '../types';

function roundClean(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function roundPermille(value: number): number {
    return Math.max(0, Math.min(1000, Math.round(value * 1000)));
}

export class SelectTool extends EditorTool {
    /** Whether Ctrl+C copies the composite or just the active layer. */
    copyMode: 'final' | 'layer' = 'final';

    constructor(engine: ImageEditorEngine) {
        super(engine, 'select', SquareDashed, 'editor.tool.select', 'editor.tool.selectDesc', 's');
    }

    getOptions(): ToolOption[] {
        return [
            {
                kind: 'select',
                key: 'copyMode',
                labelKey: 'editor.option.copy',
                value: this.copyMode,
                choices: [
                    { value: 'final', labelKey: 'editor.option.copyFinal' },
                    { value: 'layer', labelKey: 'editor.option.copyLayer' }
                ]
            },
            { kind: 'button', key: 'clear', labelKey: 'editor.option.clearSelection', disabled: !this.engine.hasSelection },
            { kind: 'button', key: 'region', labelKey: 'editor.option.makeRegion', disabled: !this.engine.hasSelection },
            { kind: 'button', key: 'ideogram', labelKey: 'editor.option.makeIdeogram', disabled: !this.engine.hasSelection }
        ];
    }

    setOption(key: string, value: ToolOptionValue): void {
        const engine = this.engine;
        if (key === 'copyMode') {
            this.copyMode = value === 'layer' ? 'layer' : 'final';
            engine.notify();
            return;
        }
        if (key === 'clear') {
            engine.clearSelection();
            return;
        }
        if (!engine.hasSelection) {
            return;
        }
        if (key === 'region') {
            // The regional-prompting syntax documented in docs/Features/Prompt Syntax.md.
            const x = roundClean(engine.selectX / engine.realWidth);
            const y = roundClean(engine.selectY / engine.realHeight);
            const width = roundClean(engine.selectWidth / engine.realWidth);
            const height = roundClean(engine.selectHeight / engine.realHeight);
            engine.host.appendToPrompt(`\n<region:${x},${y},${width},${height}>`);
        }
        else if (key === 'ideogram') {
            // Ideogram's own box format: [y1, x1, y2, x2], each 0-1000.
            const y1 = roundPermille(engine.selectY / engine.realHeight);
            const x1 = roundPermille(engine.selectX / engine.realWidth);
            const y2 = roundPermille((engine.selectY + engine.selectHeight) / engine.realHeight);
            const x2 = roundPermille((engine.selectX + engine.selectWidth) / engine.realWidth);
            engine.host.appendToPrompt(
                `\n{"type": "obj", "bbox": [${y1}, ${x1}, ${y2}, ${x2}], "desc": "My New Element"}`
            );
        }
    }

    onPointerDown(): void {
        const [x, y] = this.engine.canvasCoordToImageCoord(this.engine.pointerX, this.engine.pointerY);
        this.engine.selectX = x;
        this.engine.selectY = y;
        // A click with no drag clears the selection, which is the only way to get rid of one.
        this.engine.clearSelection();
    }

    onPointerUp(): void {
        const engine = this.engine;
        if (!engine.hasSelection) {
            return;
        }
        // Normalize, so a selection dragged up or left still has positive extents.
        if (engine.selectWidth < 0) {
            engine.selectX += engine.selectWidth;
            engine.selectWidth = -engine.selectWidth;
        }
        if (engine.selectHeight < 0) {
            engine.selectY += engine.selectHeight;
            engine.selectHeight = -engine.selectHeight;
        }
        engine.notify();
    }

    onGlobalPointerMove(): boolean {
        const engine = this.engine;
        if (!engine.pointerDown) {
            return false;
        }
        const [x, y] = engine.canvasCoordToImageCoord(engine.pointerX, engine.pointerY);
        engine.setSelection(engine.selectX, engine.selectY, x - engine.selectX, y - engine.selectY);
        engine.markChanged();
        return true;
    }
}
