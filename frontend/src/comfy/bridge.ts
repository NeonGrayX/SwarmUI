/** Direct access to the embedded ComfyUI editor.
 *
 * `/ComfyBackendDirect/` is proxied by our own server, so the iframe is same-origin and its
 * `app` object is reachable from here. That is how the existing interface drives Comfy too
 * (src/BuiltinExtensions/ComfyUIBackend/Assets/comfy_workflow_editor_helper.js) - there is no
 * message API to use instead.
 */

import { readCookie, writeCookie } from '@/api/cookies';

/** One node of the API-format prompt (what Comfy would POST to /prompt). */
export interface ComfyPromptNode {
    class_type: string;
    inputs: Record<string, unknown>;
}

export type ComfyPrompt = Record<string, ComfyPromptNode>;

/** One node of the UI-format workflow (what a .json workflow file holds). */
export interface ComfyGraphNode {
    id: number | string;
    type: string;
    title?: string;
    widgets_values?: unknown;
    inputs?: { name: string }[];
}

export interface ComfyGraph {
    nodes: ComfyGraphNode[];
    /** `[linkId, originNode, originSlot, targetNode, targetSlot, type]`. */
    links: (number | string | null)[][];
}

/** One entry of Comfy's `/object_info`: the input spec of a node class. */
export interface ComfyNodeInfo {
    input?: {
        required?: Record<string, unknown[]>;
        optional?: Record<string, unknown[]>;
    };
}

export type ComfyObjectInfo = Record<string, ComfyNodeInfo>;

interface ComfyApp {
    graphToPrompt: () => Promise<{ workflow: ComfyGraph; output: ComfyPrompt }>;
    loadGraphData: (graph: unknown) => void;
    loadApiJson: (prompt: unknown) => void;
}

interface ComfyFrameWindow extends Window {
    app?: ComfyApp;
    LiteGraph?: { cloneObject: <T>(value: T) => T };
}

let frame: HTMLIFrameElement | null = null;

/** Registered by the component that owns the iframe, so the toolbar can reach it. */
export function setComfyFrame(element: HTMLIFrameElement | null): void {
    frame = element;
}

function comfyWindow(): ComfyFrameWindow | null {
    try {
        return (frame?.contentWindow as ComfyFrameWindow | null) ?? null;
    }
    catch {
        // Cross-origin, which should not happen through the proxy but is not worth throwing over.
        return null;
    }
}

/** Whether Comfy has finished booting inside the frame. Everything below needs this first. */
export function isComfyReady(): boolean {
    return typeof comfyWindow()?.app?.graphToPrompt === 'function';
}

/** Resolves once Comfy has booted inside the frame, or rejects when it never does.
 *
 * The toolbar's own buttons can assume a booted editor - they cannot be pressed before the frame
 * is up. A workflow handed over from another screen cannot: it arrives at the same moment the
 * frame starts loading, so it has to wait for it. */
export function waitForComfy(timeoutMs = 60_000): Promise<void> {
    if (isComfyReady()) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const timer = setInterval(() => {
            if (isComfyReady()) {
                clearInterval(timer);
                resolve();
            }
            else if (Date.now() > deadline) {
                clearInterval(timer);
                reject(new Error('comfy-not-loaded'));
            }
        }, 250);
    });
}

function requireApp(): ComfyApp {
    const app = comfyWindow()?.app;
    if (!app) {
        throw new Error('comfy-not-loaded');
    }
    return app;
}

/** LiteGraph does prototype tricks on graph data, so anything handed to it has to be cloned
 *  through its own helper rather than passed in as plain parsed JSON. */
function adopt<T>(value: T): T {
    return comfyWindow()?.LiteGraph?.cloneObject(value) ?? value;
}

/** The graph as it stands right now, in both formats: UI workflow and API prompt. */
export async function graphToPrompt(): Promise<{ workflow: ComfyGraph; prompt: ComfyPrompt }> {
    const result = await requireApp().graphToPrompt();
    return { workflow: result.workflow, prompt: result.output };
}

/** Opens a UI-format workflow in the editor. */
export function loadGraph(workflow: unknown): void {
    requireApp().loadGraphData(adopt(workflow));
}

/** Opens an API-format prompt in the editor, laid out from scratch. */
export function loadApiPrompt(prompt: unknown): void {
    requireApp().loadApiJson(adopt(prompt));
}

/** Node class definitions from the live backend, used to type workflow inputs. */
export async function fetchObjectInfo(): Promise<ComfyObjectInfo> {
    const response = await fetch('/ComfyBackendDirect/object_info');
    if (!response.ok) {
        throw new Error(`object_info ${response.status}`);
    }
    return (await response.json()) as ComfyObjectInfo;
}

/** How a Comfy request is spread over multiple GPUs. Mirrors the `comfy_domulti` cookie read by
 *  the proxy route (ComfyUIRedirectHelper). 'none' is the absence of the cookie. */
export type MultiGpuMode = 'none' | 'all' | 'queue' | 'reserve';

const MULTI_GPU_COOKIE = 'comfy_domulti';

export function readMultiGpuMode(): MultiGpuMode {
    const raw = readCookie(MULTI_GPU_COOKIE);
    if (raw === 'true') {
        return 'all';
    }
    return raw === 'queue' || raw === 'reserve' ? raw : 'none';
}

export function writeMultiGpuMode(mode: MultiGpuMode): void {
    if (mode === 'none') {
        writeCookie(MULTI_GPU_COOKIE, '', -1);
        return;
    }
    writeCookie(MULTI_GPU_COOKIE, mode === 'all' ? 'true' : mode, 365);
}
