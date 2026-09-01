/** Generation run state: the batch rail, the selected image, and the live socket. */

import { create } from 'zustand';
import { api, SwarmApiError } from '@/api/client';
import type { BatchItem, GenMessage } from './types';
import type { GenIssue } from './validate';

interface GenerateStore {
    /** Batch slots for every run kept in the rail, in arrival order. */
    batch: BatchItem[];
    /** `id` of the slot shown on the canvas, or null for none. */
    selected: string | null;
    running: boolean;
    error: string | null;
    /** Why the last generate attempt was refused before it was sent. Cleared by the next attempt. */
    inputError: GenIssue | null;
    /** Set while "Generate Forever" is on. */
    forever: boolean;
    /** Handed to the next run, to keep its slots distinct from earlier runs'. */
    nextRunId: number;
    autoSwapToImages: boolean;
    autoClearBatch: boolean;

    close: (() => void) | null;

    start: (images: number, params: Record<string, unknown>) => void;
    /** Adds an already-finished file to the rail - a video edit or an audio split, neither of
     *  which the generation socket ever sees. */
    addResult: (src: string, metadata?: string | null) => void;
    /** Refuses a run that failed pre-flight validation, without touching the socket. */
    fail: (issue: GenIssue) => void;
    clearInputError: () => void;
    interrupt: (all?: boolean) => void;
    select: (id: string | null) => void;
    clearBatch: () => void;
    setForever: (on: boolean) => void;
    setAutoSwapToImages: (on: boolean) => void;
    setAutoClearBatch: (on: boolean) => void;
}

/** Slot ids must be unique across runs, since the server restarts batch_index at 0 each run. */
function slotId(runId: number, batchIndex: string): string {
    return `${runId}:${batchIndex}`;
}

function upsert(
    batch: BatchItem[],
    runId: number,
    batchIndex: string,
    patch: Partial<BatchItem>
): BatchItem[] {
    const id = slotId(runId, batchIndex);
    const existing = batch.findIndex(b => b.id === id);
    if (existing === -1) {
        return [...batch, { id, runId, batchIndex, status: 'running', ...patch }];
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
    nextRunId: 0,
    autoSwapToImages: true,
    autoClearBatch: false,
    close: null,

    start: (images, params) => {
        const state = get();
        state.close?.();

        const runId = state.nextRunId;
        if (state.autoClearBatch) {
            set({ batch: [], selected: null });
        }
        set({ running: true, error: null, inputError: null, nextRunId: runId + 1 });

        // Seed placeholder slots so the rail shows the shape of the run immediately.
        set(s => ({
            batch: [
                ...s.batch,
                ...Array.from({ length: images }, (_, i) => ({
                    id: slotId(runId, String(i)),
                    runId,
                    batchIndex: String(i),
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
                            batch: upsert(s.batch, runId, p.batch_index, {
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
                        const id = slotId(runId, index);
                        set(s => {
                            const batch = upsert(s.batch, runId, index, {
                                status: 'done',
                                src: message.image,
                                isPreview: false,
                                metadata: message.metadata ?? null,
                                overallPercent: 1
                            });
                            return {
                                batch,
                                selected: s.autoSwapToImages || s.selected === null ? id : s.selected
                            };
                        });
                        return;
                    }
                    if (message.discard_indices) {
                        const discard = new Set(message.discard_indices.map(i => slotId(runId, String(i))));
                        set(s => ({
                            batch: s.batch.map(item =>
                                discard.has(item.id) ? { ...item, status: 'discarded' as const } : item
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
                            item.runId === runId &&
                            (item.status === 'pending' || item.status === 'running')
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
                            item.runId === runId &&
                            (item.status === 'pending' || item.status === 'running')
                                ? { ...item, status: 'failed' as const }
                                : item
                        )
                    }));
                }
            }
        );

        set({ close });
    },

    /** Given a run of its own, so arriving mid-batch neither claims a pending slot nor renumbers
     *  one. It is always selected: the user asked for this file, so this file is what to show. */
    addResult: (src, metadata = null) => {
        const runId = get().nextRunId;
        const id = slotId(runId, '0');
        set(s => ({
            nextRunId: runId + 1,
            batch: [
                ...s.batch,
                { id, runId, batchIndex: '0', status: 'done' as const, src, metadata, overallPercent: 1 }
            ],
            selected: id
        }));
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

    select: id => set({ selected: id }),
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
