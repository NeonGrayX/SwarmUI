/** The SAM2 segmentation tools: click points, or drag a box, and the backend returns a mask.
 *
 * Ported from ImageEditorToolSam2Base / ImageEditorToolSam2Points / ImageEditorToolSam2BBox
 * (src/wwwroot/js/genpage/helpers/image_editor_tools.js:1366-1891).
 *
 * Both tools drive a real generation request with the segmentation parameters attached, so they
 * need the current generation input as their base - that is what `EditorHost.buildGenInput`
 * supplies. Requests are serialized by id: a click during an in-flight request queues one more
 * update rather than racing it, and results from a superseded request are dropped.
 */

import { Crosshair, SquareDashedMousePointer } from 'lucide-react';
import { EditorTool } from './base';
import type { ImageEditorEngine } from '../engine';
import type { LayerState, ToolOption } from '../types';
import type { EditorLayer } from '../layer';

interface SamPoint {
    x: number;
    y: number;
}

interface PointSet {
    positive: SamPoint[];
    negative: SamPoint[];
}

/** The image handed to SAM2, and where it sits in the document. Captured when the request is
 *  made, so a result is placed where its own image came from even if the selection has changed
 *  while it was in flight. */
interface SamInput {
    image: string;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    /** Whether the image is a crop to the selection, whose edges the mask is then clipped to. */
    cropped: boolean;
}

abstract class Sam2Tool extends EditorTool {
    protected requestSerial = 0;
    protected activeRequestId = 0;
    protected requestInFlight = false;
    private modelWarmed = false;
    protected warmingUp = false;
    private cancelWarmup: (() => void) | null = null;
    /** Stops the segmentation request in flight, if any. */
    protected cancelRequest: (() => void) | null = null;

    constructor(
        engine: ImageEditorEngine,
        id: string,
        icon: typeof Crosshair,
        labelKey: string,
        descriptionKey: string,
        hotkey: string | null = null
    ) {
        super(engine, id, icon, labelKey, descriptionKey, hotkey);
        this.isMaskOnly = true;
    }

    protected get sam2Available(): boolean {
        return this.engine.host.supportedFeatures.includes('sam2');
    }

    getOptions(): ToolOption[] {
        if (this.warmingUp) {
            return [{ kind: 'note', key: 'warmup', labelKey: 'editor.sam2.warmingUp' }];
        }
        return [{ kind: 'button', key: 'clearMask', labelKey: 'editor.option.clearMask' }];
    }

    setOption(key: string): void {
        if (key === 'clearMask') {
            this.onClearMask();
        }
    }

    protected onClearMask(): void {
        const layer = this.engine.activeLayer;
        if (layer?.isMask) {
            layer.clearToEmpty();
            this.engine.markChanged();
            this.engine.notify();
            this.engine.redraw();
        }
    }

    setActive(): void {
        super.setActive();
        // The first segmentation of a session pays for loading the model. Doing that up front, on
        // tool selection, means the user's first click responds like the ones after it.
        if (!this.modelWarmed && !this.warmingUp && this.sam2Available && this.engine.layers.length > 0) {
            this.triggerWarmup();
        }
    }

    setInactive(): void {
        super.setInactive();
        this.stopPending();
    }

    onDetach(): void {
        this.stopPending();
    }

    /** Cancels the warmup and any segmentation request, and drops whatever they would return. */
    protected stopPending(): void {
        // Abandoning a warmup leaves `modelWarmed` false on purpose, so reselecting the tool tries
        // again rather than assuming a load that never finished.
        if (this.warmingUp) {
            this.warmingUp = false;
            this.cursor = 'crosshair';
        }
        this.cancelWarmup?.();
        this.cancelWarmup = null;
        this.abandonRequests();
    }

    /** Segmentation arguments for the throwaway warmup request, around the centre of the image. */
    protected abstract addWarmupGenData(genData: Record<string, unknown>, cx: number, cy: number): void;

    private triggerWarmup(): void {
        this.warmingUp = true;
        this.cursor = 'wait';
        this.engine.notify();
        try {
            const genData = this.engine.host.buildGenInput();
            genData.initimage = this.engine.getFinalImageData();
            genData.images = 1;
            genData.prompt = '';
            genData.donotsave = true;
            delete genData.batchsize;
            this.addWarmupGenData(
                genData,
                Math.floor((this.engine.realWidth || 64) / 2),
                Math.floor((this.engine.realHeight || 64) / 2)
            );
            this.cancelWarmup = this.engine.host.runGeneration(
                genData,
                () => this.finishWarmup(),
                () => this.finishWarmup()
            );
        }
        catch {
            this.finishWarmup();
        }
    }

    private finishWarmup(): void {
        if (!this.warmingUp) {
            return;
        }
        this.modelWarmed = true;
        this.warmingUp = false;
        this.cursor = 'crosshair';
        this.cancelWarmup = null;
        this.engine.notify();
        this.engine.redraw();
    }

    /** The image SAM2 should look at: the whole output rectangle, or just the selection when
     *  there is one - a smaller image both segments faster and cannot stray outside the region. */
    private getImageForSam(): SamInput {
        const engine = this.engine;
        if (!engine.hasSelection) {
            return {
                image: engine.getFinalImageData(),
                offsetX: 0,
                offsetY: 0,
                width: Math.round(engine.realWidth),
                height: Math.round(engine.realHeight),
                cropped: false
            };
        }
        const width = Math.round(engine.selectWidth);
        const height = Math.round(engine.selectHeight);
        return {
            image: engine.getImageWithBounds(engine.selectX, engine.selectY, width, height),
            offsetX: engine.selectX,
            offsetY: engine.selectY,
            width,
            height,
            cropped: true
        };
    }

    /** The request body every SAM2 call shares, minus the segmentation arguments themselves. */
    protected getMaskRequestInputs(): [Record<string, unknown>, SamInput] {
        const samInput = this.getImageForSam();
        const genData = this.engine.host.buildGenInput();
        genData.initimage = samInput.image;
        genData.images = 1;
        genData.prompt = '';
        genData.width = samInput.width;
        genData.height = samInput.height;
        genData.donotsave = true;
        delete genData.rawresolution;
        delete genData.sidelength;
        delete genData.batchsize;
        return [genData, samInput];
    }

    /** Whether `layer` can still take a result: a mask that is still in the document. */
    protected canReceive(layer: EditorLayer | null): layer is EditorLayer {
        return layer !== null && layer.isMask && this.engine.layers.includes(layer);
    }

    /** Places a returned mask onto the layer the request was made for, undoing the crop it was
     *  made from, if any. Both come from the request rather than the editor's state now. */
    protected applyMaskResult(maskImg: HTMLImageElement, layer: EditorLayer, samInput: SamInput): void {
        const engine = this.engine;
        const full = document.createElement('canvas');
        full.width = Math.max(1, Math.round(engine.realWidth));
        full.height = Math.max(1, Math.round(engine.realHeight));
        const ctx = full.getContext('2d')!;
        const x = Math.round(samInput.offsetX);
        const y = Math.round(samInput.offsetY);
        ctx.drawImage(
            maskImg,
            0,
            0,
            maskImg.width || samInput.width,
            maskImg.height || samInput.height,
            x,
            y,
            samInput.width,
            samInput.height
        );
        layer.applyMaskFromImage(full);
        if (samInput.cropped) {
            this.clipMaskToRect(layer, x, y, samInput.width, samInput.height);
        }
        engine.markChanged();
    }

    /** Erases anything the model produced outside the crop, which it can do at the edges. */
    private clipMaskToRect(layer: EditorLayer, x: number, y: number, width: number, height: number): void {
        const ctx = layer.ctx;
        ctx.save();
        const [offsetX, offsetY] = layer.getOffset();
        layer.setImageSpaceTransform(ctx, offsetX, offsetY);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, width, height);
        ctx.restore();
    }

    /** Invalidates any in-flight request, so a late result cannot overwrite newer work. */
    protected abandonRequests(): void {
        this.activeRequestId = ++this.requestSerial;
        this.requestInFlight = false;
        this.cancelRequest?.();
        this.cancelRequest = null;
    }

    onBeforeHistoryUndo(): void {
        this.abandonRequests();
    }

    onDocumentReset(): void {
        this.abandonRequests();
    }

    /** Runs one segmentation request. `apply` gets the returned mask while the request is still
     *  current; `finish` runs exactly once when it is over - after the result has been applied, or
     *  when the request failed, returned nothing, or its image would not load - so the tool can
     *  never be left waiting on a request that is not coming back. */
    protected startRequest(
        genData: Record<string, unknown>,
        apply: (img: HTMLImageElement) => void,
        finish: () => void
    ): void {
        const requestId = ++this.requestSerial;
        this.activeRequestId = requestId;
        this.requestInFlight = true;
        // The socket can close before an image it delivered has finished decoding, so the request
        // is only over once the stream has ended *and* no image is still loading.
        let loading = 0;
        let streamEnded = false;
        let finished = false;
        const settle = () => {
            if (finished || loading > 0 || !streamEnded) {
                return;
            }
            finished = true;
            if (requestId === this.activeRequestId) {
                this.requestInFlight = false;
                this.cancelRequest = null;
                finish();
            }
        };
        const cancel = this.engine.host.runGeneration(
            genData,
            dataUrl => {
                if (requestId !== this.activeRequestId) {
                    return;
                }
                loading++;
                const img = new Image();
                img.onload = () => {
                    loading--;
                    if (requestId === this.activeRequestId) {
                        apply(img);
                    }
                    settle();
                };
                img.onerror = () => {
                    loading--;
                    settle();
                };
                img.src = dataUrl;
            },
            () => {
                streamEnded = true;
                settle();
            }
        );
        if (!finished && requestId === this.activeRequestId) {
            this.cancelRequest = cancel;
        }
    }
}

/**
 * SAM2 by point prompts: left click marks something to include, right click something to exclude,
 * and every click regenerates the mask.
 */
export class Sam2PointsTool extends Sam2Tool {
    /** Points per mask layer, so switching layers does not carry one mask's prompts to another. */
    private layerPoints = new Map<number, PointSet>();
    /** The points the mask currently on the layer was generated from, so an undo can restore them
     *  alongside the pixels it reverts. */
    private lastAppliedPoints: PointSet = { positive: [], negative: [] };
    private pendingUpdate = false;

    constructor(engine: ImageEditorEngine) {
        super(engine, 'sam2points', Crosshair, 'editor.tool.sam2Points', 'editor.tool.sam2PointsDesc', 'y');
    }

    setInactive(): void {
        super.setInactive();
        this.layerPoints = new Map();
        this.lastAppliedPoints = { positive: [], negative: [] };
        this.abandonRequests();
        this.pendingUpdate = false;
        this.flushPointsUndoHistory();
    }

    onDocumentReset(): void {
        super.onDocumentReset();
        this.layerPoints = new Map();
        this.lastAppliedPoints = { positive: [], negative: [] };
        this.pendingUpdate = false;
    }

    /** Drops the point-restoring callbacks from history entries whose points no longer exist. */
    private flushPointsUndoHistory(): void {
        for (const entry of this.engine.editHistory) {
            delete entry.data.onUndo;
        }
    }

    onBeforeHistoryUndo(): void {
        super.onBeforeHistoryUndo();
        this.pendingUpdate = false;
    }

    onLayerChanged(previous: LayerState | null, newLayer: EditorLayer | null): void {
        super.onLayerChanged(previous, newLayer);
        this.lastAppliedPoints = { positive: [], negative: [] };
    }

    private getActivePoints(): PointSet {
        const layer = this.engine.activeLayer;
        if (!layer?.isMask) {
            return { positive: [], negative: [] };
        }
        let points = this.layerPoints.get(layer.id);
        if (!points) {
            points = { positive: [], negative: [] };
            this.layerPoints.set(layer.id, points);
        }
        return points;
    }

    protected onClearMask(): void {
        const layer = this.engine.activeLayer;
        if (!layer?.isMask) {
            return;
        }
        const points = this.getActivePoints();
        points.positive = [];
        points.negative = [];
        this.lastAppliedPoints = { positive: [], negative: [] };
        this.clearMaskAndEndRequest();
        this.flushPointsUndoHistory();
    }

    private clearMaskAndEndRequest(): void {
        const layer = this.engine.activeLayer;
        if (layer?.isMask) {
            layer.clearToEmpty();
        }
        this.abandonRequests();
        this.pendingUpdate = false;
        this.engine.markChanged();
        this.engine.notify();
        this.engine.redraw();
    }

    private drawPoint(x: number, y: number, fill: string, cross: boolean): void {
        const engine = this.engine;
        const ctx = engine.ctx;
        const [cx, cy] = engine.imageCoordToCanvasCoord(x, y);
        const radius = Math.max(3, Math.round(4 * engine.zoomLevel));
        ctx.save();
        ctx.lineWidth = Math.max(1, Math.round(2 * engine.zoomLevel));
        ctx.strokeStyle = '#000000';
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        if (cross) {
            const arm = Math.max(3, Math.round(radius * 0.9));
            ctx.beginPath();
            ctx.moveTo(cx - arm, cy - arm);
            ctx.lineTo(cx + arm, cy + arm);
            ctx.moveTo(cx - arm, cy + arm);
            ctx.lineTo(cx + arm, cy - arm);
            ctx.stroke();
        }
        ctx.restore();
    }

    draw(): void {
        const points = this.getActivePoints();
        for (const point of points.positive) {
            this.drawPoint(point.x, point.y, '#33ff99', false);
        }
        for (const point of points.negative) {
            this.drawPoint(point.x, point.y, '#ff3355', true);
        }
    }

    /** Right click is a negative point, not a pan. */
    onRightPointerDown(): boolean {
        return true;
    }

    protected addWarmupGenData(genData: Record<string, unknown>, cx: number, cy: number): void {
        genData.sampositivepoints = JSON.stringify([{ x: cx, y: cy }]);
    }

    onPointerDown(e: PointerEvent): void {
        const engine = this.engine;
        if (this.warmingUp || (e.button !== 0 && e.button !== 2)) {
            return;
        }
        const [rawX, rawY] = engine.canvasCoordToImageCoord(engine.pointerX, engine.pointerY);
        const x = Math.round(rawX);
        const y = Math.round(rawY);
        if (x < 0 || y < 0 || x >= engine.realWidth || y >= engine.realHeight) {
            return;
        }
        if (
            engine.hasSelection &&
            (x < engine.selectX ||
                y < engine.selectY ||
                x >= engine.selectX + engine.selectWidth ||
                y >= engine.selectY + engine.selectHeight)
        ) {
            return;
        }

        const points = this.getActivePoints();
        // Clicking with the *other* button near an existing point removes it, which is how a
        // mis-placed point gets taken back without a separate erase mode.
        const opposite = e.button === 2 ? points.positive : points.negative;
        const nearIndex = opposite.findIndex(p => {
            const [cx, cy] = engine.imageCoordToCanvasCoord(p.x, p.y);
            return (cx - engine.pointerX) ** 2 + (cy - engine.pointerY) ** 2 < 100;
        });
        if (nearIndex >= 0) {
            e.preventDefault();
            opposite.splice(nearIndex, 1);
            if (points.positive.length === 0) {
                this.clearMaskAndEndRequest();
            }
            else {
                this.queueMaskUpdate();
            }
            return;
        }

        if (e.button === 2) {
            e.preventDefault();
            points.negative.push({ x, y });
        }
        else {
            points.positive.push({ x, y });
        }
        this.queueMaskUpdate();
        engine.redraw();
    }

    private queueMaskUpdate(): void {
        if (!this.sam2Available) {
            this.engine.host.onSam2Missing();
            return;
        }
        // SAM2 has nothing to segment towards without at least one positive point.
        if (this.getActivePoints().positive.length === 0) {
            return;
        }
        if (this.requestInFlight) {
            this.pendingUpdate = true;
            return;
        }
        this.requestMaskUpdate();
    }

    /** The request is over; send the clicks that arrived meanwhile, if any. */
    private finishMaskUpdate(): void {
        if (this.pendingUpdate) {
            this.pendingUpdate = false;
            this.queueMaskUpdate();
        }
    }

    private requestMaskUpdate(): void {
        const engine = this.engine;
        const [genData, samInput] = this.getMaskRequestInputs();
        const points = this.getActivePoints();
        const shift = (p: SamPoint) => ({ x: p.x - samInput.offsetX, y: p.y - samInput.offsetY });
        genData.sampositivepoints = JSON.stringify(points.positive.map(shift));
        if (points.negative.length > 0) {
            genData.samnegativepoints = JSON.stringify(points.negative.map(shift));
        }
        const previousPoints: PointSet = {
            positive: [...this.lastAppliedPoints.positive],
            negative: [...this.lastAppliedPoints.negative]
        };
        const thisRequestPoints: PointSet = {
            positive: [...points.positive],
            negative: [...points.negative]
        };
        const maskLayer = engine.activeLayer;

        this.startRequest(
            genData,
            img => {
                if (!this.canReceive(maskLayer)) {
                    return;
                }
                this.applyMaskResult(img, maskLayer, samInput);
                // Undoing the mask has to take the points that produced it back too, or the next
                // click would regenerate from a prompt the user can no longer see.
                const last = engine.editHistory.at(-1);
                if (last) {
                    last.data.onUndo = () => {
                        this.layerPoints.set(maskLayer.id, {
                            positive: [...previousPoints.positive],
                            negative: [...previousPoints.negative]
                        });
                        this.lastAppliedPoints = previousPoints;
                    };
                }
                this.lastAppliedPoints = thisRequestPoints;
                engine.notify();
                engine.redraw();
            },
            () => this.finishMaskUpdate()
        );
    }
}

/** SAM2 by bounding box: drag a box, release, and the model segments what is inside it. */
export class Sam2BBoxTool extends Sam2Tool {
    private startX: number | null = null;
    private startY: number | null = null;
    private endX = 0;
    private endY = 0;
    private drawing = false;

    constructor(engine: ImageEditorEngine) {
        super(
            engine,
            'sam2bbox',
            SquareDashedMousePointer,
            'editor.tool.sam2BBox',
            'editor.tool.sam2BBoxDesc'
        );
    }

    onDocumentReset(): void {
        super.onDocumentReset();
        this.startX = null;
        this.startY = null;
        this.drawing = false;
    }

    draw(): void {
        if (!this.drawing || this.startX === null || this.startY === null) {
            return;
        }
        const engine = this.engine;
        const ctx = engine.ctx;
        const [x1, y1] = engine.imageCoordToCanvasCoord(this.startX, this.startY);
        const [x2, y2] = engine.imageCoordToCanvasCoord(this.endX, this.endY);
        ctx.save();
        ctx.strokeStyle = '#33ff99';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.restore();
    }

    protected addWarmupGenData(genData: Record<string, unknown>, cx: number, cy: number): void {
        genData.sambbox = JSON.stringify([cx - 1, cy - 1, cx + 1, cy + 1]);
    }

    onPointerDown(e: PointerEvent): void {
        if (this.warmingUp || e.button !== 0) {
            return;
        }
        const [x, y] = this.engine.canvasCoordToImageCoord(this.engine.pointerX, this.engine.pointerY);
        this.drawing = true;
        this.startX = Math.round(x);
        this.startY = Math.round(y);
        this.endX = this.startX;
        this.endY = this.startY;
    }

    onGlobalPointerMove(): boolean {
        if (!this.drawing || !this.engine.pointerDown) {
            return false;
        }
        const [x, y] = this.engine.canvasCoordToImageCoord(this.engine.pointerX, this.engine.pointerY);
        this.endX = Math.round(x);
        this.endY = Math.round(y);
        return true;
    }

    onGlobalPointerUp(): boolean {
        if (this.warmingUp || !this.drawing) {
            return false;
        }
        this.drawing = false;
        this.requestMaskUpdate();
        return true;
    }

    private requestMaskUpdate(): void {
        const engine = this.engine;
        if (!this.sam2Available) {
            engine.host.onSam2Missing();
            return;
        }
        if (this.startX === null || this.startY === null) {
            return;
        }
        let minX = Math.max(0, Math.min(this.startX, this.endX));
        let minY = Math.max(0, Math.min(this.startY, this.endY));
        let maxX = Math.min(engine.realWidth - 1, Math.max(this.startX, this.endX));
        let maxY = Math.min(engine.realHeight - 1, Math.max(this.startY, this.endY));
        if (engine.hasSelection) {
            minX = Math.max(minX, engine.selectX);
            minY = Math.max(minY, engine.selectY);
            maxX = Math.min(maxX, engine.selectX + engine.selectWidth);
            maxY = Math.min(maxY, engine.selectY + engine.selectHeight);
        }
        if (maxX <= minX || maxY <= minY) {
            return;
        }

        const [genData, samInput] = this.getMaskRequestInputs();
        const maskLayer = engine.activeLayer;
        genData.sambbox = JSON.stringify([
            minX - samInput.offsetX,
            minY - samInput.offsetY,
            maxX - samInput.offsetX,
            maxY - samInput.offsetY
        ]);

        this.startRequest(
            genData,
            img => {
                if (!this.canReceive(maskLayer)) {
                    return;
                }
                this.applyMaskResult(img, maskLayer, samInput);
                engine.notify();
                engine.redraw();
            },
            () => {}
        );
    }
}
