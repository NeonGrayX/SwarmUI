/** Generation run state: the batch rail, the selected image, and the live socket.
 *
 * Replaces the scattered globals in src/wwwroot/js/genpage/helpers/generatehandler.js and
 * gentab/currentimagehandler.js.
 */

import { create } from 'zustand';
import { api, SwarmApiError } from '@/api/client';
import type { BatchItem, GenMessage } from './types';
import type { GenIssue } from './validate';

interface GenerateStore {
    /** Batch slots keyed by batch_index, in arrival order. */
    batch: BatchItem[];
    /** batch_index of the image shown on the canvas, or null for none. */
    selected: string | null;
    running: boolean;
    error: string | null;
    /** Why the last generate attempt was refused before it was sent. Cleared by the next attempt. */
    inputError: GenIssue | null;
    /** Set while "Generate Forever" is on. */
    forever: boolean;
    autoSwapToImages: boolean;
    autoClearBatch: boolean;

    close: (() => void) | null;

    start: (images: number, params: Record<string, unknown>) => void;
    /** Refuses a run that failed pre-flight validation, without touching the socket. */
    fail: (issue: GenIssue) => void;
    clearInputError: () => void;
    interrupt: (all?: boolean) => void;
    select: (batchIndex: string | null) => void;
    clearBatch: () => void;
    setForever: (on: boolean) => void;
    setAutoSwapToImages: (on: boolean) => void;
    setAutoClearBatch: (on: boolean) => void;
}

function upsert(batch: BatchItem[], batchIndex: string, patch: Partial<BatchItem>): BatchItem[] {
    const existing = batch.findIndex(b => b.batchIndex === batchIndex);
    if (existing === -1) {
        return [...batch, { batchIndex, status: 'running', ...patch }];
    }
    const next = [...batch];
    next[existing] = { ...next[existing], ...patch };
    return next;
}

export const useGenerateStore = create<GenerateStore>((set, get) => ({
    batch: [],
    selected: null,
    running: false,
    error: null,
    inputError: null,
    forever: false,
    autoSwapToImages: true,
    autoClearBatch: false,
    close: null,

    start: (images, params) => {
        const state = get();
        state.close?.();

        if (state.autoClearBatch) {
            set({ batch: [], selected: null });
        }
        set({ running: true, error: null, inputError: null });

        // Seed placeholder slots so the rail shows the shape of the run immediately.
        const offset = state.autoClearBatch ? 0 : get().batch.length;
        set(s => ({
            batch: [
                ...s.batch,
                ...Array.from({ length: images }, (_, i) => ({
                    batchIndex: String(offset + i),
                    status: 'pending' as const
                }))
            ]
        }));

        const close = api.stream<GenMessage>(
            'GenerateText2ImageWS',
            { images, ...params },
            {
                onMessage: message => {
                    if (message.gen_progress) {
                        const p = message.gen_progress;
                        set(s => ({
                            batch: upsert(s.batch, p.batch_index, {
                                status: 'running',
                                overallPercent: p.overall_percent,
                                currentPercent: p.current_percent,
                                ...(p.preview ? { src: p.preview, isPreview: true } : {})
                            })
                        }));
                        return;
                    }
                    if (message.image && message.batch_index !== undefined) {
                        const index = message.batch_index;
                        set(s => {
                            const batch = upsert(s.batch, index, {
                                status: 'done',
                                src: message.image,
                                isPreview: false,
                                metadata: message.metadata ?? null,
                                overallPercent: 1
                            });
                            return {
                                batch,
                                selected: s.autoSwapToImages || s.selected === null ? index : s.selected
                            };
                        });
                        return;
                    }
                    if (message.discard_indices) {
                        const discard = new Set(message.discard_indices.map(String));
                        set(s => ({
                            batch: s.batch.map(item =>
                                discard.has(item.batchIndex) ? { ...item, status: 'discarded' as const } : item
                            )
                        }));
                    }
                },
                onError: (error: SwarmApiError) => {
                    set(s => ({
                        error: error.message,
                        running: false,
                        forever: false,
                        batch: s.batch.map(item =>
                            item.status === 'pending' || item.status === 'running'
                                ? { ...item, status: 'failed' as const, error: error.message }
                                : item
                        )
                    }));
                },
                onClose: () => {
                    set(s => ({
                        running: false,
                        close: null,
                        batch: s.batch.map(item =>
                            item.status === 'pending' || item.status === 'running'
                                ? { ...item, status: 'failed' as const }
                                : item
                        )
                    }));
                }
            }
        );

        set({ close });
    },

    /** Stops "generate forever" too, so a bad request cannot re-fire on a loop. */
    fail: issue => set({ inputError: issue, running: false, forever: false }),
    clearInputError: () => set({ inputError: null }),

    /** `all` interrupts every session this user has open, not just this tab
     *  (InterruptAll's `other_sessions`, src/WebAPI/BasicAPIFeatures.cs). */
    interrupt: (all = false) => {
        get().close?.();
        set({ running: false, forever: false, close: null });
        api.post('InterruptAll', { other_sessions: all }).catch(() => {
            // The socket is already closed locally; a failed interrupt call is not worth a toast.
        });
    },

    select: batchIndex => set({ selected: batchIndex }),
    clearBatch: () => set({ batch: [], selected: null }),
    setForever: on => set({ forever: on }),
    setAutoSwapToImages: on => set({ autoSwapToImages: on }),
    setAutoClearBatch: on => set({ autoClearBatch: on })
}));

/** Resolves a batch item's src to something an <img> can load.
 *  Backends return either a relative view path or an inline data URL. */
export function imageUrl(src: string | undefined): string | undefined {
    if (!src) {
        return undefined;
    }
    return src.startsWith('data:') || src.startsWith('http') ? src : `/${src.replace(/^\//, '')}`;
}
