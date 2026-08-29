/** The image editor engine: view, layers, history, input dispatch, rendering and export.
 *  Ported from ImageEditor (src/wwwroot/js/genpage/helpers/image_editor.js:332).
 *
 * The engine owns its `<canvas>` and drives it imperatively - a brush stroke is not a diffable
 * thing, so React would gain nothing from re-rendering sixty times a second. React owns everything
 * around the canvas (toolbar, layer panel, option bar) and learns about structural changes through
 * `subscribe`, which the engine fires only for discrete events: a layer added, a tool switched, an
 * option edited. Pointer motion and repaints deliberately do not notify.
 *
 * Two rules that are easy to trip over:
 *   - pen, touch and mouse are one pointer-event code path; pressure comes from `pressureOf`
 *   - the backing canvas is sized in *device* pixels, while all coordinate maths stays in CSS
 *     pixels (`viewWidth`/`viewHeight`). Only `getImageData` callers have to scale, via
 *     `devicePixel`
 */

import { HistoryEntry } from './history';
import { EditorLayer } from './layer';
import { mixHex } from './color';
import type { EditorExport, ToolInfo } from './types';
import type { ColorTool, EditorTool } from './tools/base';
import { buildTools } from './tools';

/** Services the engine needs from the application around it. */
export interface EditorHost {
    /** Feature flags the connected backends report; gates the SAM2 tools. */
    supportedFeatures: string[];
    /** The current generation request body, used as the basis for SAM2 segmentation calls. */
    buildGenInput: () => Record<string, unknown>;
    /** Runs a one-off generation, calling back with each returned image. Returns a canceller. */
    runGeneration: (
        body: Record<string, unknown>,
        onImage: (dataUrl: string) => void,
        onDone?: () => void
    ) => () => void;
    /** A transient message for the user, by translation key. */
    notice: (key: string, tone: 'ok' | 'error') => void;
    /** SAM2 was asked for but is not installed on any backend. */
    onSam2Missing: () => void;
    /** Appends text to the prompt - the selection tool's region helpers. */
    appendToPrompt: (text: string) => void;
}

const NO_HOST: EditorHost = {
    supportedFeatures: [],
    buildGenInput: () => ({}),
    runGeneration: () => () => {},
    notice: () => {},
    onSam2Missing: () => {},
    appendToPrompt: () => {}
};

/** Undo depth. Each `layer_canvas_edit` entry holds a full-resolution copy of a layer, so this
 *  trades directly against memory. */
const MAX_HISTORY = 15;
const ZOOM_RATE = 1.1;
const GRID_SCALE = 4;

/** How soon after the first finger a second one has to land for the pair to read as one gesture,
 *  rather than as a stroke the user then decided to zoom out of. */
const GESTURE_GRACE_MS = 250;
/** And how little the first finger may have travelled in that time. */
const GESTURE_GRACE_SLOP = 16;

/** The span and midpoint of a two-finger gesture, in canvas coordinates. */
interface GestureFrame {
    distance: number;
    centerX: number;
    centerY: number;
}

export class ImageEditorEngine {
    /* ---- Palette ------------------------------------------------------------------------- */
    backgroundColor = '#202020';
    gridColor = '#404040';
    uiColor = '#606060';
    uiBorderColor = '#b0b0b0';
    textColor = '#ffffff';
    boundaryColor = '#ffff00';

    /* ---- Wiring -------------------------------------------------------------------------- */
    host: EditorHost = NO_HOST;
    /** Bumped by any edit that changes the exported image. */
    changeCount = 0;

    /* ---- View ---------------------------------------------------------------------------- */
    canvas: HTMLCanvasElement | null = null;
    ctx!: CanvasRenderingContext2D;
    /** Canvas size in CSS pixels. All coordinate maths uses these, never `canvas.width`. */
    viewWidth = 100;
    viewHeight = 100;
    devicePixel = 1;
    zoomLevel = 1;
    offsetX = 0;
    offsetY = 0;

    /* ---- Pointer ------------------------------------------------------------------------- */
    pointerX = 0;
    pointerY = 0;
    lastPointerX = 0;
    lastPointerY = 0;
    pointerDown = false;
    altDown = false;
    /** True while the pointer in use is a fingertip. Hit targets a mouse can land on exactly are
     *  grown when this is set; nothing about what the tools *do* changes with it. */
    coarsePointer = false;
    /** Every pointer currently down on the canvas, in canvas coordinates. A second entry is what
     *  turns a stroke into a pinch, which is the only pan and zoom touch has. */
    private pointers = new Map<number, { x: number; y: number }>();
    /** The previous span and midpoint of the pinching pair, or null when none is in progress. */
    private gesture: GestureFrame | null = null;
    /** Set for as long as any finger of a gesture is still down, so the survivor of a pinch does
     *  not start drawing from wherever the zoom left it. */
    private gestureLock = false;
    /** When and where the first finger landed, and what could be undone at that moment - enough to
     *  put the document back as it was if the press turns out to have been half of a pinch. */
    private touchStartedAt = 0;
    private touchStartX = 0;
    private touchStartY = 0;
    private touchStartMark: { history: number; selection: number[]; hasSelection: boolean } | null = null;

    /* ---- Document ------------------------------------------------------------------------ */
    /** The output rectangle: what a generation actually receives. */
    realWidth = 512;
    realHeight = 512;
    finalOffsetX = 0;
    finalOffsetY = 0;
    layers: EditorLayer[] = [];
    activeLayer: EditorLayer | null = null;
    private totalLayersEver = 0;

    /* ---- Selection ----------------------------------------------------------------------- */
    selectX = 0;
    selectY = 0;
    selectWidth = 0;
    selectHeight = 0;
    hasSelection = false;

    /* ---- Tools --------------------------------------------------------------------------- */
    tools: Record<string, EditorTool> = {};
    activeTool!: EditorTool;
    private toolHotkeys: Record<string, string> = {};
    private preAltTool: EditorTool | null = null;

    /* ---- History ------------------------------------------------------------------------- */
    editHistory: HistoryEntry[] = [];

    /* ---- React bridge -------------------------------------------------------------------- */
    private listeners = new Set<() => void>();
    private version = 0;

    private maskHelperCanvas: HTMLCanvasElement;
    private maskHelperCtx: CanvasRenderingContext2D;
    private detachers: (() => void)[] = [];
    private frame = 0;
    private antsTimer = 0;
    /** Whether the host element currently has a box at all. A pane that is hidden when the editor
     *  opens reports zero, and a view fitted to nothing is not a view. */
    private viewSized = false;
    /** Whether the current document has been fitted to a real view yet. */
    private fitted = false;

    constructor() {
        this.maskHelperCanvas = document.createElement('canvas');
        this.maskHelperCtx = this.maskHelperCanvas.getContext('2d')!;
        for (const tool of buildTools(this)) {
            this.tools[tool.id] = tool;
            if (tool.hotkey) {
                this.toolHotkeys[tool.hotkey] = tool.id;
            }
        }
        this.activeTool = this.tools.brush;
        this.activeTool.setActive();
    }

    /* ============================ React subscription ============================ */

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getVersion = (): number => this.version;

    /** Announces a structural change - a layer, a tool, a tool option, the selection appearing or
     *  vanishing. Never called from the render loop or from pointer motion. */
    notify(): void {
        this.version++;
        for (const listener of this.listeners) {
            listener();
        }
    }

    /** Records an edit that changes what a generation would receive. */
    markChanged(): void {
        this.changeCount++;
    }

    /* ============================ Attach / detach ============================ */

    /** Binds the engine to a host element, creating the canvas and its listeners. */
    attach(host: HTMLElement): () => void {
        const canvas = document.createElement('canvas');
        canvas.className = 'absolute inset-0 h-full w-full touch-none';
        host.appendChild(canvas);
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;

        const on = <K extends keyof HTMLElementEventMap>(
            target: HTMLElement | Window | Document,
            type: K | string,
            handler: (e: never) => void,
            options?: AddEventListenerOptions
        ) => {
            target.addEventListener(type, handler as EventListener, options);
            this.detachers.push(() => target.removeEventListener(type, handler as EventListener, options));
        };

        on(canvas, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e));
        on(canvas, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
        on(canvas, 'pointerup', (e: PointerEvent) => this.onPointerUp(e));
        on(canvas, 'pointercancel', (e: PointerEvent) => this.onPointerUp(e));
        // Non-passive, so a wheel over the canvas zooms instead of scrolling the page.
        on(canvas, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
        on(canvas, 'contextmenu', (e: MouseEvent) => e.preventDefault());
        on(canvas, 'dragover', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        });
        on(canvas, 'drop', (e: DragEvent) => this.handleImageDrop(e));
        on(window, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e));
        on(window, 'keyup', (e: KeyboardEvent) => this.onKeyUp(e));
        // Alt-tabbing away leaves the Alt key logically stuck down otherwise.
        on(window, 'blur', () => this.handleAltUp());
        on(document, 'paste', (e: ClipboardEvent) => this.handlePasteEvent(e));

        const observer = new ResizeObserver(() => this.resize());
        observer.observe(host);
        this.detachers.push(() => observer.disconnect());

        this.coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        this.fitted = false;
        this.resize();
        // Keeps the marching ants marching; everything else repaints on the event that caused it.
        this.antsTimer = window.setInterval(() => {
            if (this.hasSelection) {
                this.redraw();
            }
        }, 250);

        return () => this.detach();
    }

    private detach(): void {
        window.clearInterval(this.antsTimer);
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        for (const off of this.detachers) {
            off();
        }
        this.detachers = [];
        this.pointers.clear();
        this.gesture = null;
        this.gestureLock = false;
        this.pointerDown = false;
        this.canvas?.remove();
        this.canvas = null;
    }

    /** Matches the backing store to the host's current size. */
    resize(): void {
        const canvas = this.canvas;
        if (!canvas?.parentElement) {
            return;
        }
        const host = canvas.parentElement;
        this.devicePixel = window.devicePixelRatio || 1;
        this.viewSized = host.clientWidth >= 1 && host.clientHeight >= 1;
        this.viewWidth = Math.max(100, host.clientWidth);
        this.viewHeight = Math.max(100, host.clientHeight);
        canvas.width = Math.round(this.viewWidth * this.devicePixel);
        canvas.height = Math.round(this.viewHeight * this.devicePixel);
        this.maskHelperCanvas.width = canvas.width;
        this.maskHelperCanvas.height = canvas.height;
        // The first size that is real is also the first chance to frame the document properly.
        if (this.viewSized && !this.fitted) {
            this.autoZoom();
            return;
        }
        this.redraw();
    }

    /** Fits the output rectangle into the view with a little margin. */
    autoZoom(): void {
        this.fitted = this.viewSized;
        this.zoomLevel = Math.min(this.viewWidth / this.realWidth, this.viewHeight / this.realHeight) * 0.9;
        const [x, y] = this.imageCoordToCanvasCoord(this.realWidth / 2, this.realHeight / 2);
        this.offsetX = this.viewWidth / 2 - x;
        this.offsetY = this.viewHeight / 2 - y;
        this.redraw();
    }

    /* ============================ Coordinates ============================ */

    canvasCoordToImageCoord(x: number, y: number): [number, number] {
        return [x / this.zoomLevel - this.offsetX, y / this.zoomLevel - this.offsetY];
    }

    imageCoordToCanvasCoord(x: number, y: number): [number, number] {
        return [(x + this.offsetX) * this.zoomLevel, (y + this.offsetY) * this.zoomLevel];
    }

    isPointerInBox(x: number, y: number, width: number, height: number): boolean {
        return this.pointerX >= x && this.pointerX < x + width && this.pointerY >= y && this.pointerY < y + height;
    }

    isPointerInCircle(x: number, y: number, radius: number): boolean {
        const dx = this.pointerX - x;
        const dy = this.pointerY - y;
        return dx * dx + dy * dy < radius * radius;
    }

    private updatePointerFrom(e: PointerEvent | WheelEvent): void {
        const rect = this.canvas?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        this.pointerX = e.clientX - rect.left;
        this.pointerY = e.clientY - rect.top;
    }

    private canvasPointOf(e: PointerEvent): { x: number; y: number } {
        const rect = this.canvas?.getBoundingClientRect();
        return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    }

    /* ============================ Tools ============================ */

    /** Toolbar entries, in registration order. */
    getToolInfos(): ToolInfo[] {
        return Object.values(this.tools).map(tool => ({
            id: tool.id,
            icon: tool.icon,
            labelKey: tool.labelKey,
            descriptionKey: tool.descriptionKey,
            hotkey: tool.hotkey,
            hidden: tool.hidden
        }));
    }

    /** The tool whose options the bar shows and whose button the toolbar highlights. While a
     *  sub-tool is borrowing control - the eyedropper - that is the tool it is serving, so the
     *  swatch it is picking into stays on screen. */
    get optionsTool(): EditorTool {
        return this.activeTool.optionsOwner;
    }

    activateTool(id: string): void {
        const next = this.tools[id];
        if (!next || (next.hidden && !next.isTempTool)) {
            return;
        }
        if (this.activeTool && !next.isTempTool) {
            this.activeTool.setInactive();
        }
        next.setActive();
        this.activeTool = next;
        this.notify();
        this.redraw();
    }

    /** Arms the eyedropper on behalf of a colour tool, which it hands control back to. */
    startEyedropper(tool: ColorTool): void {
        const picker = this.tools.picker as EditorTool & { toolFor: ColorTool | null };
        picker.toolFor = tool;
        this.activateTool('picker');
    }

    /** The Alt key (and the middle/right button) temporarily borrows the General tool, so the
     *  canvas can always be panned without losing the tool in hand.
     *
     *  Deliberately not routed through `activateTool`: that would run the borrowed-from tool's
     *  teardown, and the SAM2 point tool's teardown throws its points away - panning mid-
     *  segmentation would clear the prompt built up so far. */
    handleAltDown(): void {
        if (this.preAltTool || this.activeTool.id === 'general') {
            return;
        }
        this.preAltTool = this.activeTool;
        this.activeTool = this.tools.general;
        this.activeTool.setActive();
        this.notify();
        this.redraw();
    }

    handleAltUp(): void {
        this.altDown = false;
        if (!this.preAltTool) {
            return;
        }
        this.tools.general.setInactive();
        this.activeTool = this.preAltTool;
        this.preAltTool = null;
        this.notify();
        this.redraw();
    }

    /* ============================ History ============================ */

    addHistoryEntry(entry: HistoryEntry): void {
        if (this.editHistory.length >= MAX_HISTORY) {
            this.editHistory.splice(0, 1);
        }
        this.editHistory.push(entry);
    }

    get canUndo(): boolean {
        return this.editHistory.length > 0;
    }

    undoOnce(): void {
        if (this.editHistory.length === 0) {
            return;
        }
        this.activeTool.onBeforeHistoryUndo();
        this.editHistory.pop()!.undo();
        this.markChanged();
        this.notify();
        this.redraw();
    }

    /* ============================ Layers ============================ */

    setActiveLayer(layer: EditorLayer | null): void {
        if (layer && !this.layers.includes(layer)) {
            return;
        }
        const oldLayer = this.activeLayer;
        this.activeLayer = layer;
        for (const tool of Object.values(this.tools)) {
            tool.onLayerChanged(oldLayer, layer);
        }
        this.notify();
        this.redraw();
    }

    clearLayers(): void {
        this.layers = [];
        this.activeLayer = null;
        this.realWidth = 512;
        this.realHeight = 512;
        this.finalOffsetX = 0;
        this.finalOffsetY = 0;
        this.editHistory = [];
        this.hasSelection = false;
    }

    addEmptyLayer(): void {
        this.addLayer(new EditorLayer(this, this.realWidth, this.realHeight));
    }

    addEmptyMaskLayer(): void {
        const layer = new EditorLayer(this, this.realWidth, this.realHeight);
        layer.isMask = true;
        this.addLayer(layer);
    }

    addImageLayer(img: HTMLImageElement): EditorLayer {
        const layer = new EditorLayer(this, img.naturalWidth || img.width, img.naturalHeight || img.height);
        layer.ctx.drawImage(img, 0, 0);
        layer.hasAnyContent = true;
        this.addLayer(layer);
        return layer;
    }

    /** Loads an image URL and drops it in as a layer centred on the pointer. */
    addImageLayerFromUrl(src: string): void {
        const img = new Image();
        img.onload = () => {
            const layer = this.addImageLayer(img);
            const [x, y] = this.canvasCoordToImageCoord(this.pointerX, this.pointerY);
            layer.offsetX = x - layer.width / 2;
            layer.offsetY = y - layer.height / 2;
            this.activateTool('general');
            this.markChanged();
            this.redraw();
        };
        img.src = src;
    }

    addLayer(layer: EditorLayer, skipHistory = false, index?: number): void {
        if (layer.id < 0) {
            layer.id = this.totalLayersEver++;
        }
        if (index === undefined || index < 0 || index > this.layers.length) {
            this.layers.push(layer);
        }
        else {
            this.layers.splice(index, 0, layer);
        }
        this.sortLayers();
        this.setActiveLayer(layer);
        if (!skipHistory) {
            this.addHistoryEntry(new HistoryEntry(this, 'layer_add', { layer }));
        }
        this.markChanged();
        this.notify();
        this.redraw();
    }

    removeLayer(layer: EditorLayer, skipHistory = false): void {
        const index = this.layers.indexOf(layer);
        if (index < 0) {
            return;
        }
        if (!skipHistory) {
            this.addHistoryEntry(new HistoryEntry(this, 'layer_remove', { layer, index }));
        }
        this.layers.splice(index, 1);
        if (this.activeLayer === layer) {
            this.setActiveLayer(this.layers[Math.max(0, index - 1)] ?? null);
        }
        this.markChanged();
        this.notify();
        this.redraw();
    }

    /** Flips a layer between image and mask, then re-groups. */
    setLayerIsMask(layer: EditorLayer, isMask: boolean): void {
        const wasMask = layer.isMask;
        layer.isMask = isMask;
        this.sortLayers();
        // Converting the layer in hand is the same event as switching to a layer of the other
        // kind: a mask-only tool may have to stand down, and a colour tool has to swap memories.
        if (layer === this.activeLayer) {
            for (const tool of Object.values(this.tools)) {
                tool.onLayerChanged({ isMask: wasMask }, layer);
            }
        }
        this.markChanged();
        this.notify();
        this.redraw();
    }

    setLayerOpacity(layer: EditorLayer, opacity: number): void {
        layer.opacity = opacity;
        this.markChanged();
        this.notify();
        this.redraw();
    }

    /** Reorders a layer within its own kind. Index positions are in display order, ie the reverse
     *  of `layers` - the topmost layer is drawn last. */
    moveLayer(layer: EditorLayer, targetIndex: number): void {
        const from = this.layers.indexOf(layer);
        if (from < 0 || targetIndex < 0 || targetIndex > this.layers.length) {
            return;
        }
        this.layers.splice(from, 1);
        this.layers.splice(targetIndex > from ? targetIndex - 1 : targetIndex, 0, layer);
        this.sortLayers();
        this.markChanged();
        this.notify();
        this.redraw();
    }

    /** Masks always sit above image layers, so a mask is never hidden behind an image. */
    sortLayers(): void {
        this.layers = [...this.layers.filter(l => !l.isMask), ...this.layers.filter(l => l.isMask)];
    }

    /** Replaces the whole document with one image: the image itself, an empty layer to draw on,
     *  and an empty mask. Matches setBaseImage (image_editor.js:979). */
    setBaseImage(img: HTMLImageElement): void {
        this.clearLayers();
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const base = new EditorLayer(this, width, height);
        base.ctx.drawImage(img, 0, 0);
        base.hasAnyContent = true;
        this.addLayer(base, true);
        this.addLayer(new EditorLayer(this, width, height), true);
        const mask = new EditorLayer(this, width, height);
        mask.isMask = true;
        this.addLayer(mask, true);
        this.realWidth = width;
        this.realHeight = height;
        this.offsetX = 0;
        this.offsetY = 0;
        this.editHistory = [];
        this.fitted = false;
        for (const tool of Object.values(this.tools)) {
            tool.onDocumentReset();
        }
        this.setActiveLayer(base);
        this.autoZoom();
        this.notify();
    }

    /** Opens a blank white document of the given size. */
    setBlankImage(width: number, height: number): void {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const img = new Image();
        img.onload = () => this.setBaseImage(img);
        img.src = canvas.toDataURL();
    }

    /** Follows the width/height params while the editor is open. */
    setOutputSize(width: number, height: number): void {
        if (this.realWidth === width && this.realHeight === height) {
            return;
        }
        this.realWidth = width;
        this.realHeight = height;
        this.markChanged();
        this.notify();
        this.redraw();
    }

    /* ============================ Input ============================ */

    private onPointerDown(e: PointerEvent): void {
        this.coarsePointer = e.pointerType === 'touch';
        this.pointers.set(e.pointerId, this.canvasPointOf(e));
        // A second finger is a pinch, not a second stroke: hand the pair to the view instead.
        if (this.pointers.size > 1) {
            this.beginGesture(e);
            return;
        }
        if (this.gestureLock) {
            return;
        }
        this.updatePointerFrom(e);
        this.lastPointerX = this.pointerX;
        this.lastPointerY = this.pointerY;
        this.touchStartedAt = e.pointerType === 'touch' ? performance.now() : 0;
        this.touchStartX = this.pointerX;
        this.touchStartY = this.pointerY;
        this.touchStartMark = {
            history: this.editHistory.length,
            selection: [this.selectX, this.selectY, this.selectWidth, this.selectHeight],
            hasSelection: this.hasSelection
        };
        this.capturePointer(e.pointerId);
        // Middle button pans; right button pans unless the tool wants it.
        if (this.altDown || e.button === 1) {
            this.handleAltDown();
        }
        if (e.button === 2 && !this.activeTool.onRightPointerDown(e)) {
            this.handleAltDown();
        }
        this.pointerDown = true;
        this.activeTool.onPointerDown(e);
        this.redraw();
    }

    private onPointerMove(e: PointerEvent): void {
        if (this.pointers.has(e.pointerId)) {
            this.pointers.set(e.pointerId, this.canvasPointOf(e));
        }
        if (this.gestureLock) {
            this.updateGesture();
            return;
        }
        this.updatePointerFrom(e);
        let draw = false;
        if (this.isPointerInBox(0, 0, this.viewWidth, this.viewHeight)) {
            this.activeTool.onPointerMove(e);
            draw = true;
        }
        if (this.activeTool.onGlobalPointerMove(e)) {
            draw = true;
        }
        if (draw) {
            this.redraw();
        }
        this.lastPointerX = this.pointerX;
        this.lastPointerY = this.pointerY;
    }

    private onPointerUp(e: PointerEvent): void {
        this.pointers.delete(e.pointerId);
        if (this.gestureLock) {
            // Lifting one of three fingers leaves a pinch that has to restart from where the
            // remaining pair now is, or the view would jump by the gap the lifted finger left.
            this.gesture = this.gestureFrame();
            this.gestureLock = this.pointers.size > 0;
            this.releaseCapture(e.pointerId);
            return;
        }
        this.updatePointerFrom(e);
        if (e.button === 1 || e.button === 2) {
            this.handleAltUp();
        }
        const wasDown = this.pointerDown;
        this.pointerDown = false;
        this.activeTool.onPointerUp(e);
        if (this.activeTool.onGlobalPointerUp(e) || wasDown) {
            this.redraw();
        }
        this.releaseCapture(e.pointerId);
    }

    private releaseCapture(pointerId: number): void {
        if (this.canvas?.hasPointerCapture(pointerId)) {
            this.canvas.releasePointerCapture(pointerId);
        }
    }

    /* ---- Pinch to pan and zoom ---------------------------------------------------------- */

    /** Ends whatever the first finger was doing and starts a two-finger view gesture.
     *
     * Two fingers never land at the same instant, so by the time the second arrives the first has
     * already had the tool do something - a dab of paint, a bucket fill, a cleared selection. When
     * they landed together it was meant as a pinch and not as an edit, so the stroke is closed
     * properly (which is what puts it on the undo stack) and then rolled straight back off it. A
     * press that has been held or dragged for a while is a real edit and is kept. */
    private beginGesture(e: PointerEvent): void {
        if (this.pointerDown) {
            const mark = this.touchStartMark;
            const together =
                mark !== null &&
                this.touchStartedAt > 0 &&
                performance.now() - this.touchStartedAt < GESTURE_GRACE_MS &&
                Math.hypot(this.pointerX - this.touchStartX, this.pointerY - this.touchStartY) <
                    GESTURE_GRACE_SLOP;
            this.pointerDown = false;
            this.activeTool.onPointerUp(e);
            this.activeTool.onGlobalPointerUp(e);
            if (mark && together) {
                while (this.editHistory.length > mark.history) {
                    this.undoOnce();
                }
                [this.selectX, this.selectY, this.selectWidth, this.selectHeight] = mark.selection;
                this.hasSelection = mark.hasSelection;
            }
        }
        this.gestureLock = true;
        this.gesture = this.gestureFrame();
        this.redraw();
    }

    private gestureFrame(): GestureFrame | null {
        const points = [...this.pointers.values()];
        if (points.length < 2) {
            return null;
        }
        const [a, b] = points;
        return {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            centerX: (a.x + b.x) / 2,
            centerY: (a.y + b.y) / 2
        };
    }

    /** Zooms by how much the fingers spread, and pans by where their midpoint went - expressed as
     *  the one rule that covers both: the content under the old midpoint ends up under the new. */
    private updateGesture(): void {
        const previous = this.gesture;
        const frame = this.gestureFrame();
        if (!previous || !frame) {
            return;
        }
        const [anchorX, anchorY] = this.canvasCoordToImageCoord(previous.centerX, previous.centerY);
        if (previous.distance > 1 && frame.distance > 1) {
            const zoom = this.zoomLevel * (frame.distance / previous.distance);
            this.zoomLevel = Math.max(0.01, Math.min(100, zoom));
        }
        this.offsetX = frame.centerX / this.zoomLevel - anchorX;
        this.offsetY = frame.centerY / this.zoomLevel - anchorY;
        this.gesture = frame;
        // Tools draw their overlays at the pointer; parking it at the midpoint keeps a brush
        // outline from sitting where the first finger happened to have been.
        this.pointerX = this.lastPointerX = frame.centerX;
        this.pointerY = this.lastPointerY = frame.centerY;
        this.redraw();
    }

    /** Routes the rest of the gesture to the canvas even once the pointer leaves it, which is what
     *  lets a drag continue past the edge. Best-effort: the pointer can already be gone by the time
     *  the event is handled, and that throws - losing the capture is survivable, losing the rest of
     *  the press handler is not. */
    private capturePointer(pointerId: number): void {
        try {
            this.canvas?.setPointerCapture(pointerId);
        }
        catch {
            // No active pointer with that id; the gesture ended before we got to it.
        }
    }

    private onWheel(e: WheelEvent): void {
        this.updatePointerFrom(e);
        this.activeTool.onWheel(e);
        if (!e.defaultPrevented) {
            e.preventDefault();
            const zoom = Math.pow(ZOOM_RATE, -e.deltaY / 100);
            const [origX, origY] = this.canvasCoordToImageCoord(this.pointerX, this.pointerY);
            this.zoomLevel = Math.max(0.01, Math.min(100, this.zoomLevel * zoom));
            const [newX, newY] = this.canvasCoordToImageCoord(this.pointerX, this.pointerY);
            this.offsetX += newX - origX;
            this.offsetY += newY - origY;
        }
        this.redraw();
    }

    /** True while the user is typing somewhere, so single-letter hotkeys stay out of the way. */
    private isTypingTarget(target: EventTarget | null): boolean {
        const element = target as HTMLElement | null;
        return (
            element?.isContentEditable === true ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')
        );
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Alt') {
            this.altDown = true;
            if (!this.isTypingTarget(e.target)) {
                e.preventDefault();
                this.handleAltDown();
            }
            return;
        }
        if (this.isTypingTarget(e.target)) {
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.undoOnce();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && this.activeTool.id === 'select') {
            e.preventDefault();
            const select = this.activeTool as EditorTool & { copyMode?: string };
            void this.copySelectionToClipboard(select.copyMode === 'layer');
            return;
        }
        if (e.key === 'Delete' && this.activeLayer) {
            if (this.activeTool.id === 'general') {
                e.preventDefault();
                this.removeLayer(this.activeLayer);
            }
            else if (this.activeTool.id === 'select') {
                e.preventDefault();
                this.clearSelectionOnLayer(this.activeLayer);
            }
            return;
        }
        if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
            const toolId = this.toolHotkeys[e.key.toLowerCase()];
            if (toolId) {
                e.preventDefault();
                this.activateTool(toolId);
            }
        }
    }

    private onKeyUp(e: KeyboardEvent): void {
        if (e.key === 'Alt') {
            this.handleAltUp();
        }
    }

    private handleImageDrop(e: DragEvent): void {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        this.updatePointerFrom(e as unknown as PointerEvent);
        for (const file of Array.from(files)) {
            if (file.type.startsWith('image/')) {
                this.readFileAsLayer(file);
            }
        }
    }

    /** Native paste, which works without the clipboard-read permission Firefox does not grant. */
    private handlePasteEvent(e: ClipboardEvent): void {
        if (this.isTypingTarget(e.target)) {
            return;
        }
        for (const item of Array.from(e.clipboardData?.items ?? [])) {
            const file = item.kind === 'file' ? item.getAsFile() : null;
            if (file?.type.startsWith('image/')) {
                e.preventDefault();
                this.readFileAsLayer(file);
                return;
            }
        }
    }

    private readFileAsLayer(file: File): void {
        const reader = new FileReader();
        reader.onload = ev => this.addImageLayerFromUrl(String(ev.target?.result));
        reader.readAsDataURL(file);
    }

    /* ============================ Clipboard ============================ */

    /** Copies the selection - the composite, or just the active layer. */
    async copySelectionToClipboard(currentLayerOnly = false): Promise<void> {
        if (!this.hasSelection || this.selectWidth <= 0 || this.selectHeight <= 0) {
            this.host.notice('editor.notice.noSelection', 'error');
            return;
        }
        const layerOnly = currentLayerOnly ? this.activeLayer : null;
        if (currentLayerOnly && !layerOnly) {
            this.host.notice('editor.notice.noSelection', 'error');
            return;
        }
        const dataUrl = this.getImageWithBounds(
            this.selectX,
            this.selectY,
            this.selectWidth,
            this.selectHeight,
            'image/png',
            layerOnly
        );
        try {
            const blob = await (await fetch(dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            this.host.notice('editor.notice.copied', 'ok');
        }
        catch {
            this.host.notice('editor.notice.copyFailed', 'error');
        }
    }

    /** Pastes an image from the clipboard as a new layer. Browsers that refuse programmatic
     *  clipboard reads still work through the native paste handler above. */
    async pasteFromClipboard(): Promise<void> {
        if (!navigator.clipboard?.read) {
            this.host.notice('editor.notice.pasteUnsupported', 'error');
            return;
        }
        try {
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find(t => t.startsWith('image/'));
                if (type) {
                    const blob = await item.getType(type);
                    const reader = new FileReader();
                    reader.onload = ev => this.addImageLayerFromUrl(String(ev.target?.result));
                    reader.readAsDataURL(blob);
                    return;
                }
            }
            this.host.notice('editor.notice.noClipboardImage', 'error');
        }
        catch {
            this.host.notice('editor.notice.pasteUnsupported', 'error');
        }
    }

    /* ============================ Selection ============================ */

    setSelection(x: number, y: number, width: number, height: number): void {
        const had = this.hasSelection;
        this.selectX = x;
        this.selectY = y;
        this.selectWidth = width;
        this.selectHeight = height;
        this.hasSelection = true;
        if (!had) {
            this.notify();
        }
    }

    clearSelection(): void {
        if (!this.hasSelection) {
            return;
        }
        this.hasSelection = false;
        this.selectWidth = 0;
        this.selectHeight = 0;
        this.notify();
        this.redraw();
    }

    /** Erases the selected region from one layer - the Delete key under the Select tool. */
    clearSelectionOnLayer(layer: EditorLayer): void {
        if (!this.hasSelection || this.selectWidth === 0 || this.selectHeight === 0) {
            return;
        }
        const [cx1, cy1] = this.imageCoordToCanvasCoord(this.selectX, this.selectY);
        const [lx1, ly1] = layer.canvasCoordToLayerCoord(cx1, cy1);
        const [cx2, cy2] = this.imageCoordToCanvasCoord(
            this.selectX + this.selectWidth,
            this.selectY + this.selectHeight
        );
        const [lx2, ly2] = layer.canvasCoordToLayerCoord(cx2, cy2);
        const clampX = (v: number) => Math.max(0, Math.min(Math.round(v), layer.canvas.width));
        const clampY = (v: number) => Math.max(0, Math.min(Math.round(v), layer.canvas.height));
        const minX = clampX(Math.min(lx1, lx2));
        const minY = clampY(Math.min(ly1, ly2));
        const width = clampX(Math.max(lx1, lx2)) - minX;
        const height = clampY(Math.max(ly1, ly2)) - minY;
        if (width <= 0 || height <= 0) {
            return;
        }
        layer.saveBeforeEdit();
        layer.ctx.clearRect(minX, minY, width, height);
        this.markChanged();
        this.notify();
        this.redraw();
    }

    /* ============================ Rendering ============================ */

    /** Requests a repaint on the next animation frame. Repeated calls within a frame coalesce. */
    redraw(): void {
        if (this.frame !== 0 || !this.canvas) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.paint();
        });
    }

    private renderFullGrid(scale: number, width: number, color: string): void {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.lineWidth = width;
        const [leftX, topY] = this.canvasCoordToImageCoord(0, 0);
        const [rightX, bottomY] = this.canvasCoordToImageCoord(this.viewWidth, this.viewHeight);
        for (let x = Math.floor(leftX / scale) * scale; x < rightX; x += scale) {
            const [canvasX] = this.imageCoordToCanvasCoord(x, 0);
            ctx.moveTo(canvasX, 0);
            ctx.lineTo(canvasX, this.viewHeight);
        }
        for (let y = Math.floor(topY / scale) * scale; y < bottomY; y += scale) {
            const [, canvasY] = this.imageCoordToCanvasCoord(0, y);
            ctx.moveTo(0, canvasY);
            ctx.lineTo(this.viewWidth, canvasY);
        }
        ctx.stroke();
    }

    /** A dashed rectangle, optionally rotated. `'diff'` draws in difference mode, so the marching
     *  ants stay legible against whatever is underneath them. */
    drawSelectionBox(
        x: number,
        y: number,
        width: number,
        height: number,
        color: string,
        spacing: number,
        angle: number,
        offset = 0
    ): void {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.setLineDash([spacing, spacing]);
        ctx.lineDashOffset = offset;
        if (color === 'diff') {
            ctx.globalCompositeOperation = 'difference';
            ctx.strokeStyle = 'white';
        }
        else {
            ctx.strokeStyle = color;
        }
        ctx.translate(x + width / 2, y + height / 2);
        ctx.rotate(angle);
        ctx.moveTo(-width / 2 - 1, -height / 2 - 1);
        ctx.lineTo(width / 2 + 1, -height / 2 - 1);
        ctx.lineTo(width / 2 + 1, height / 2 + 1);
        ctx.lineTo(-width / 2 - 1, height / 2 + 1);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    private paint(): void {
        const canvas = this.canvas;
        if (!canvas) {
            return;
        }
        const ctx = this.ctx;
        ctx.setTransform(this.devicePixel, 0, 0, this.devicePixel, 0, 0);
        ctx.save();
        canvas.style.cursor = this.activeTool.cursor;

        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

        // Grid, coarsening as the view zooms out so lines never crowd into a solid block. The
        // finer grid fades in as the coarser one spreads far enough apart to make room for it.
        let gridScale = GRID_SCALE;
        while (gridScale * this.zoomLevel < 32) {
            gridScale *= 8;
        }
        if (gridScale > GRID_SCALE) {
            const fraction = (gridScale * this.zoomLevel - 32) / (32 * 8);
            this.renderFullGrid(gridScale / 8, 1, mixHex(this.gridColor, this.backgroundColor, fraction));
        }
        this.renderFullGrid(gridScale, 3, this.gridColor);

        for (const layer of this.layers) {
            if (!layer.isMask) {
                layer.drawToBack(ctx, this.offsetX, this.offsetY, this.zoomLevel);
            }
        }

        // Masks composite as luminosity so they read as a highlight over the image rather than
        // painting it out - stronger while a mask layer is being worked on.
        this.maskHelperCtx.setTransform(this.devicePixel, 0, 0, this.devicePixel, 0, 0);
        this.maskHelperCtx.clearRect(0, 0, this.viewWidth, this.viewHeight);
        for (const layer of this.layers) {
            if (layer.isMask) {
                layer.drawToBack(this.maskHelperCtx, this.offsetX, this.offsetY, this.zoomLevel);
            }
        }
        ctx.save();
        ctx.globalAlpha = this.activeLayer?.isMask ? 0.8 : 0.3;
        ctx.globalCompositeOperation = 'luminosity';
        ctx.drawImage(this.maskHelperCanvas, 0, 0, this.viewWidth, this.viewHeight);
        ctx.restore();

        const [boundaryX, boundaryY] = this.imageCoordToCanvasCoord(this.finalOffsetX, this.finalOffsetY);
        this.drawSelectionBox(
            boundaryX,
            boundaryY,
            this.realWidth * this.zoomLevel,
            this.realHeight * this.zoomLevel,
            this.boundaryColor,
            16 * this.zoomLevel,
            0
        );

        if (this.activeLayer) {
            const [ox, oy] = this.activeLayer.getOffset();
            const [layerX, layerY] = this.imageCoordToCanvasCoord(ox, oy);
            this.drawSelectionBox(
                layerX,
                layerY,
                this.activeLayer.width * this.zoomLevel,
                this.activeLayer.height * this.zoomLevel,
                this.uiBorderColor,
                8 * this.zoomLevel,
                this.activeLayer.rotation
            );
        }

        if (this.hasSelection) {
            const [selectX, selectY] = this.imageCoordToCanvasCoord(this.selectX, this.selectY);
            const offset = (Math.floor(Date.now() / 250) % 4) * 4 * this.zoomLevel;
            this.drawSelectionBox(
                selectX,
                selectY,
                this.selectWidth * this.zoomLevel,
                this.selectHeight * this.zoomLevel,
                'diff',
                8 * this.zoomLevel,
                0,
                offset
            );
        }

        this.activeTool.draw();
        ctx.restore();
    }

    /* ============================ Export ============================ */

    /** The composited image (or one layer) over an arbitrary rectangle of image space. */
    getImageWithBounds(
        x: number,
        y: number,
        width: number,
        height: number,
        format = 'image/png',
        layerOnly: EditorLayer | null = null
    ): string {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const ctx = canvas.getContext('2d')!;
        const offsetX = this.finalOffsetX - Math.round(x);
        const offsetY = this.finalOffsetY - Math.round(y);
        if (layerOnly) {
            layerOnly.drawToBack(ctx, offsetX, offsetY, 1);
        }
        else {
            for (const layer of this.layers) {
                if (!layer.isMask) {
                    layer.drawToBack(ctx, offsetX, offsetY, 1);
                }
            }
        }
        return canvas.toDataURL(format);
    }

    /** The image as a generation would receive it: the output rectangle, image layers only. */
    getFinalImageData(format = 'image/png'): string {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(this.realWidth));
        canvas.height = Math.max(1, Math.round(this.realHeight));
        const ctx = canvas.getContext('2d')!;
        for (const layer of this.layers) {
            if (!layer.isMask) {
                layer.drawToBack(ctx, this.finalOffsetX, this.finalOffsetY, 1);
            }
        }
        return canvas.toDataURL(format);
    }

    /** Everything, including whatever hangs outside the output rectangle. */
    getMaximumImageData(format = 'image/png'): string {
        let minX = 0;
        let minY = 0;
        let maxX = this.realWidth;
        let maxY = this.realHeight;
        for (const layer of this.layers) {
            if (layer.isMask) {
                continue;
            }
            const [x, y] = layer.getOffset();
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + layer.width);
            maxY = Math.max(maxY, y + layer.height);
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(maxX - minX));
        canvas.height = Math.max(1, Math.round(maxY - minY));
        const ctx = canvas.getContext('2d')!;
        for (const layer of this.layers) {
            if (!layer.isMask) {
                layer.drawToBack(ctx, -minX, -minY, 1);
            }
        }
        return canvas.toDataURL(format);
    }

    /** The black/white mask for inpainting: white is what the model may repaint.
     *
     *  With no mask layer drawn, the whole rectangle is white - "regenerate everything". Once
     *  there is one, the image layers' *coverage* is painted black first, so an area the user
     *  left transparent (outpainting past the edge of the source image) counts as maskable even
     *  though nobody painted a mask over it. */
    getFinalMaskData(format = 'image/png'): string {
        const width = Math.max(1, Math.round(this.realWidth));
        const height = Math.max(1, Math.round(this.realHeight));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        if (this.layers.some(l => l.isMask && l.hasAnyContent)) {
            // Quarter resolution: this pass only needs each pixel's alpha, and the upscale back to
            // full size is what softens the coverage edge.
            const coverage = document.createElement('canvas');
            coverage.width = Math.max(1, Math.round(width / 4));
            coverage.height = Math.max(1, Math.round(height / 4));
            const coverageCtx = coverage.getContext('2d')!;
            for (const layer of this.layers) {
                if (!layer.isMask) {
                    layer.drawToBack(coverageCtx, this.finalOffsetX, this.finalOffsetY, 1 / 4);
                }
            }
            const imageData = coverageCtx.getImageData(0, 0, coverage.width, coverage.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
            }
            coverageCtx.putImageData(imageData, 0, 0);
            ctx.drawImage(coverage, 0, 0, width, height);
            for (const layer of this.layers) {
                if (layer.isMask) {
                    layer.drawToBack(ctx, this.finalOffsetX, this.finalOffsetY, 1);
                }
            }
        }

        // Force to greyscale: a mask painted in colour still has to arrive as brightness.
        const flattened = document.createElement('canvas');
        flattened.width = width;
        flattened.height = height;
        const flatCtx = flattened.getContext('2d')!;
        flatCtx.fillStyle = '#000000';
        flatCtx.fillRect(0, 0, width, height);
        flatCtx.globalCompositeOperation = 'luminosity';
        flatCtx.drawImage(canvas, 0, 0);
        return flattened.toDataURL(format);
    }

    /** Everything a generation needs from the editor. */
    exportForGeneration(): EditorExport {
        return {
            initImage: this.getFinalImageData(),
            maskImage: this.getFinalMaskData(),
            // Latent dimensions are multiples of 8.
            width: Math.floor(this.realWidth / 8) * 8,
            height: Math.floor(this.realHeight / 8) * 8
        };
    }
}
