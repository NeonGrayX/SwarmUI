/** The General tool: pan the canvas, and move / resize / rotate the active layer.
 *
 * Ported from ImageEditorToolGeneral (src/wwwroot/js/genpage/helpers/image_editor_tools.js:339).
 * Alt, the middle button and (unless a tool claims it) the right button all borrow this tool while
 * held, so panning is always one gesture away whatever is in hand.
 *
 * The handle glyphs are drawn as canvas paths: this UI ships no image assets, and a path stays
 * crisp on a HiDPI canvas.
 */

import { MousePointer2 } from 'lucide-react';
import { EditorTool } from './base';
import type { ImageEditorEngine } from '../engine';

type HandleName =
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'center-top'
    | 'center-bottom'
    | 'center-left'
    | 'center-right'
    | 'positioner'
    | 'rotator';

interface Handle {
    name: HandleName;
    x: number;
    y: number;
    radius: number;
    /** How close a press has to land. Wider than the drawn grip on a touch screen, where a
     *  fingertip covers far more than the four pixels a mouse can aim at. */
    hitRadius: number;
    glyph?: 'move' | 'rotate';
}

/** Which edges each resize handle drags: [left, right, top, bottom]. */
const HANDLE_EDGES: Record<string, [boolean, boolean, boolean, boolean]> = {
    'top-left': [true, false, true, false],
    'top-right': [false, true, true, false],
    'bottom-left': [true, false, false, true],
    'bottom-right': [false, true, false, true],
    'center-top': [false, false, true, false],
    'center-bottom': [false, false, false, true],
    'center-left': [true, false, false, false],
    'center-right': [false, true, false, false]
};

export class GeneralTool extends EditorTool {
    private dragHandle: HandleName | null = null;

    constructor(engine: ImageEditorEngine) {
        super(engine, 'general', MousePointer2, 'editor.tool.general', 'editor.tool.generalDesc', 'g');
    }

    private fixCursor(): void {
        this.cursor = this.engine.pointerDown ? 'grabbing' : 'crosshair';
    }

    /** The eight resize grips plus the move and rotate handles, in screen coordinates. */
    private handles(): Handle[] {
        const engine = this.engine;
        const layer = engine.activeLayer;
        if (!layer) {
            return [];
        }
        const [offsetX, offsetY] = engine.imageCoordToCanvasCoord(layer.offsetX, layer.offsetY);
        const width = layer.width * engine.zoomLevel;
        const height = layer.height * engine.zoomLevel;
        // A four-pixel grip is invisible under a fingertip, so touch gets a larger one - and a
        // larger press target still, since the two handles above the layer sit close together.
        const r = engine.coarsePointer ? 6 : 4;
        const hit = engine.coarsePointer ? 13 : r;
        // How far above the layer the move and rotate handles float. Held near the mouse figure
        // rather than scaled with the grips, so the touch layout does not push them further out of
        // the view than the layer's own top edge already is.
        const lift = engine.coarsePointer ? 36 : 32;
        const grip = (name: HandleName, x: number, y: number): Handle => ({
            name,
            x,
            y,
            radius: r,
            hitRadius: hit
        });
        const handles: Handle[] = [
            grip('top-left', offsetX - r / 2, offsetY - r / 2),
            grip('top-right', offsetX + width + r / 2, offsetY - r / 2),
            grip('bottom-left', offsetX - r / 2, offsetY + height + r / 2),
            grip('bottom-right', offsetX + width + r / 2, offsetY + height + r / 2),
            grip('center-top', offsetX + width / 2, offsetY - r / 2),
            grip('center-bottom', offsetX + width / 2, offsetY + height + r / 2),
            grip('center-left', offsetX - r / 2, offsetY + height / 2),
            grip('center-right', offsetX + width + r / 2, offsetY + height / 2),
            {
                name: 'positioner',
                radius: r * 2,
                hitRadius: Math.max(hit, r * 2),
                x: offsetX + width / 2,
                y: offsetY - lift,
                glyph: 'move'
            },
            {
                name: 'rotator',
                radius: r * 2,
                hitRadius: Math.max(hit, r * 2),
                x: offsetX + width / 2,
                y: offsetY - lift * 2,
                glyph: 'rotate'
            }
        ];
        const angle = layer.rotation;
        if (angle === 0) {
            return handles;
        }
        const cx = offsetX + width / 2;
        const cy = offsetY + height / 2;
        for (const handle of handles) {
            const x = Math.round(handle.x) - cx;
            const y = Math.round(handle.y) - cy;
            handle.x = x * Math.cos(angle) - y * Math.sin(angle) + cx;
            handle.y = x * Math.sin(angle) + y * Math.cos(angle) + cy;
        }
        return handles;
    }

    private getHandle(name: HandleName): Handle | undefined {
        return this.handles().find(h => h.name === name);
    }

    /** A four-way arrow, in a box of `size` centred on the origin. */
    private strokeMoveGlyph(ctx: CanvasRenderingContext2D, size: number): void {
        const arm = size / 2;
        const head = size / 5;
        ctx.beginPath();
        ctx.moveTo(-arm, 0);
        ctx.lineTo(arm, 0);
        ctx.moveTo(0, -arm);
        ctx.lineTo(0, arm);
        for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
        ]) {
            ctx.moveTo(dx * arm, dy * arm);
            ctx.lineTo(dx * (arm - head) - dy * head, dy * (arm - head) - dx * head);
            ctx.moveTo(dx * arm, dy * arm);
            ctx.lineTo(dx * (arm - head) + dy * head, dy * (arm - head) + dx * head);
        }
        ctx.stroke();
    }

    /** A three-quarter circular arrow. */
    private strokeRotateGlyph(ctx: CanvasRenderingContext2D, size: number): void {
        const radius = size / 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, radius, Math.PI * 0.35, Math.PI * 1.9);
        ctx.stroke();
        const head = size / 4;
        ctx.beginPath();
        ctx.moveTo(radius, -head * 0.2);
        ctx.lineTo(radius - head * 0.6, head * 0.5);
        ctx.lineTo(radius + head * 0.6, head * 0.5);
        ctx.closePath();
        ctx.fill();
    }

    draw(): void {
        this.fixCursor();
        const ctx = this.engine.ctx;
        for (const handle of this.handles()) {
            const hot = this.engine.isPointerInCircle(handle.x, handle.y, handle.hitRadius);
            if (hot && this.engine.canvas) {
                this.engine.canvas.style.cursor = 'grab';
            }
            ctx.save();
            ctx.lineWidth = 1;
            ctx.strokeStyle = hot ? '#000000' : '#ffffff';
            ctx.fillStyle = hot ? '#ffffff' : '#000000';
            if (handle.glyph) {
                // Filled disc behind the glyph, so it reads over image content of any colour.
                ctx.beginPath();
                ctx.arc(handle.x, handle.y, handle.radius + 1, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
                ctx.translate(handle.x, handle.y);
                ctx.lineWidth = 1.25;
                ctx.lineCap = 'round';
                ctx.strokeStyle = hot ? '#000000' : '#ffffff';
                ctx.fillStyle = hot ? '#000000' : '#ffffff';
                if (handle.glyph === 'move') {
                    this.strokeMoveGlyph(ctx, handle.radius * 1.8);
                }
                else {
                    this.strokeRotateGlyph(ctx, handle.radius * 1.8);
                }
            }
            else {
                ctx.beginPath();
                ctx.arc(handle.x, handle.y, handle.radius, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    onPointerDown(): void {
        this.fixCursor();
        this.dragHandle = null;
        if (!this.engine.activeLayer) {
            return;
        }
        for (const handle of this.handles()) {
            if (this.engine.isPointerInCircle(handle.x, handle.y, handle.hitRadius)) {
                this.engine.activeLayer.savePositions();
                this.dragHandle = handle.name;
                break;
            }
        }
    }

    onPointerUp(): void {
        this.fixCursor();
        this.dragHandle = null;
    }

    onGlobalPointerMove(e: PointerEvent): boolean {
        const engine = this.engine;
        if (!engine.pointerDown) {
            return false;
        }
        const target = engine.activeLayer;
        if (!target || !this.dragHandle) {
            // Nothing grabbed: the drag pans the view.
            engine.offsetX += (engine.pointerX - engine.lastPointerX) / engine.zoomLevel;
            engine.offsetY += (engine.pointerY - engine.lastPointerY) / engine.zoomLevel;
            return true;
        }
        let [mouseX, mouseY] = engine.canvasCoordToImageCoord(engine.pointerX, engine.pointerY);

        if (this.dragHandle === 'rotator') {
            const centerX = target.offsetX + target.width / 2;
            const centerY = target.offsetY + target.height / 2;
            target.rotation = Math.atan2(mouseY - centerY, mouseX - centerX) + Math.PI / 2;
            if (e.ctrlKey) {
                // 16 stops per half-turn, ie 11.25 degrees.
                target.rotation = Math.round(target.rotation / (Math.PI / 16)) * (Math.PI / 16);
            }
            engine.markChanged();
            return true;
        }

        const current = this.getHandle(this.dragHandle);
        if (!current) {
            return true;
        }
        const [handleX, handleY] = engine.canvasCoordToImageCoord(current.x, current.y);

        // Ctrl snaps to a grid coarse enough to still be visible at the current zoom.
        let roundFactor = 1;
        if (e.ctrlKey) {
            roundFactor = 8;
            while (roundFactor * engine.zoomLevel < 16) {
                roundFactor *= 4;
            }
        }

        const rotateAround = (x: number, y: number): [number, number] => {
            const cx = target.offsetX + target.width / 2;
            const cy = target.offsetY + target.height / 2;
            const dx = x - cx;
            const dy = y - cy;
            const angle = target.rotation;
            return [
                dx * Math.cos(angle) - dy * Math.sin(angle) + cx,
                dx * Math.sin(angle) + dy * Math.cos(angle) + cy
            ];
        };

        // Corner handles preserve aspect by projecting the pointer onto the centre-to-corner line;
        // Shift releases that. Edge handles and the mover never constrain.
        if (!e.shiftKey && !current.name.startsWith('center') && current.name !== 'positioner') {
            const cX = target.offsetX + target.width / 2;
            const cY = target.offsetY + target.height / 2;
            let dirX = handleX - cX;
            let dirY = handleY - cY;
            const length = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
            dirX /= length;
            dirY /= length;
            const projection = (mouseX - cX) * dirX + (mouseY - cY) * dirY;
            mouseX = cX + dirX * projection;
            mouseY = cY + dirY * projection;
        }

        let dx = Math.round(mouseX / roundFactor) * roundFactor - handleX;
        let dy = Math.round(mouseY / roundFactor) * roundFactor - handleY;

        if (current.name === 'positioner') {
            target.offsetX += dx;
            target.offsetY += dy;
            engine.markChanged();
            return true;
        }

        // Resizing happens in the layer's own unrotated frame.
        const angle = -target.rotation;
        [dx, dy] = [
            dx * Math.cos(angle) - dy * Math.sin(angle),
            dx * Math.sin(angle) + dy * Math.cos(angle)
        ];
        const edges = HANDLE_EDGES[current.name];
        if (!edges) {
            return true;
        }
        const [moveLeft, moveRight, moveTop, moveBottom] = edges;
        const origX = target.offsetX;
        const origY = target.offsetY;
        const origWidth = target.width;
        const origHeight = target.height;
        const anchorXFraction = moveLeft ? 1 : moveRight ? 0 : 0.5;
        const anchorYFraction = moveTop ? 1 : moveBottom ? 0 : 0.5;
        const [origAnchorX, origAnchorY] = rotateAround(
            origX + anchorXFraction * origWidth,
            origY + anchorYFraction * origHeight
        );

        if (moveLeft) {
            const change = Math.min(dx, target.width - 1);
            target.offsetX += change;
            target.width -= change;
        }
        else if (moveRight) {
            target.width += Math.max(dx, 1 - target.width);
        }
        if (moveTop) {
            const change = Math.min(dy, target.height - 1);
            target.offsetY += change;
            target.height -= change;
        }
        else if (moveBottom) {
            target.height += Math.max(dy, 1 - target.height);
        }

        // A rotated layer resizes about its rotated anchor, so the opposite edge stays put.
        const [newAnchorX, newAnchorY] = rotateAround(
            target.offsetX + anchorXFraction * target.width,
            target.offsetY + anchorYFraction * target.height
        );
        target.offsetX += origAnchorX - newAnchorX;
        target.offsetY += origAnchorY - newAnchorY;
        engine.markChanged();
        return true;
    }
}
