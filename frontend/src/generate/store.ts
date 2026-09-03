/** Generation run state: the batch rail, the selected image, and the live sockets. */

import { useMemo } from 'react';
import { create } from 'zustand';
import { api, SOCKET_FAILED, SwarmApiError } from '@/api/client';
import type { StreamClose } from '@/api/client';
import { t } from '@/i18n/store';
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
    /** Set when a run's socket dropped with slots still unfinished. The server does not stop
     *  generating when the browser stops listening, so this is a warning about this tab's view of
     *  the run, not about the run. */
    disconnected: boolean;
    autoSwapToImages: boolean;
    autoClearBatch: boolean;

    start: (images: number, params: Record<string, unknown>) => void;
    /** Adds an already-finished file to the rail - a video edit or an audio split, neither of
     *  which the generation socket ever sees. */
    addResult: (src: string, metadata?: string | null) => void;
    /** Refuses a run that failed pre-flight validation, without touching the socket. */
    fail: (issue: GenIssue) => void;
    clearInputError: () => void;
    dismissDisconnected: () => void;
    interrupt: (all?: boolean) => void;
    select: (id: string | null) => void;
    clearBatch: () => void;
    setForever: (on: boolean) => void;
    setAutoSwapToImages: (on: boolean) => void;
    setAutoClearBatch: (on: boolean) => void;
}

/** Disposers for the sockets of runs still in flight, keyed by run id.
 *
 * Kept outside the store because they are not state to render, and because their real purpose is
 * to be honest about how many runs are live: a run is over when its socket has reported closing,
 * not when a newer run has started. Closing a generation socket does not interrupt the generation
 * behind it (T2IAPI's claim outlives the socket), so a run that is superseded is left alone to
 * finish and keep filling in its own slots. */
const liveRuns = new Map<number, () => void>();

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

/** A slot the server still owes us something for. */
function isUnfinished(item: BatchItem): boolean {
    return item.status === 'pending' || item.status === 'running';
}

/** Settles a run whose socket has closed.
 *
 * The distinction this makes is the whole point of it. A socket closing is not evidence that a
 * generation failed - the server's claim on the backend outlives the connection, so a run whose
 * socket dropped is still generating and will still save its images to the history. Calling those
 * slots "failed" is a lie the user can act on, so each way a socket can end gets its own answer:
 *
 *  - the server said the run was over (`socket_intention: close`): a slot with no image really did
 *    fail, and nothing more is coming for it.
 *  - the socket never connected: the request never reached the server, so nothing was started.
 *  - we closed it ourselves: the user interrupted, so the slots were cancelled.
 *  - anything else - a phone switching apps, wi-fi dropping, a proxy timing out - is this tab
 *    losing sight of a run that is very probably still going.
 */
function endRun(
    runId: number,
    info: StreamClose,
    serverEnded: boolean,
    set: (partial: Partial<GenerateStore> | ((s: GenerateStore) => Partial<GenerateStore>)) => void
): void {
    liveRuns.delete(runId);
    // A socket that never opened means the request never reached the server, so those slots really
    // did fail - but with an explanation, since bare "failed" reads as a generation problem.
    const neverStarted = !info.opened;
    const note = neverStarted ? t('generate.couldNotConnect') : undefined;
    const status = serverEnded || neverStarted ? 'failed' : info.local ? 'cancelled' : 'disconnected';
    set(s => {
        // Only worth saying anything if the run still had work outstanding - a socket closing on a
        // run that already delivered everything is just the run ending.
        const outstanding = s.batch.some(item => item.runId === runId && isUnfinished(item));
        return {
            // Other runs may still be going: this tab is only idle once every socket has closed.
            running: liveRuns.size > 0,
            // A dropped connection must not re-fire the loop, or a phone coming back from sleep
            // finds a queue of runs nobody asked for.
            ...(outstanding && status === 'disconnected' ? { disconnected: true, forever: false } : {}),
            ...(outstanding && note ? { error: note } : {}),
            batch: s.batch.map(item =>
                item.runId === runId && isUnfinished(item)
                    ? { ...item, status, error: note ?? item.error }
                    : item
            )
        };
    });
}

export const useGenerateStore = create<GenerateStore>((set, get) => ({
    batch: [],
    selected: null,
    running: false,
    error: null,
    inputError: null,
    forever: false,
    nextRunId: 0,
    disconnected: false,
    autoSwapToImages: true,
    autoClearBatch: false,

    start: (images, params) => {
        const state = get();
        const runId = state.nextRunId;
        if (state.autoClearBatch) {
            set({ batch: [], selected: null });
        }
        set({ running: true, error: null, inputError: null, disconnected: false, nextRunId: runId + 1 });

        /** Set when the server announces the run is over, which is what separates "this run
         *  finished" from "this socket stopped talking to us". */
        let serverEnded = false;

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
                    if (message.socket_intention === 'close') {
                        serverEnded = true;
                        return;
                    }
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
                // Only an error the server actually reported condemns the run. A socket that
                // merely dropped is left for `onClose`, which always follows it and can tell a
                // lost connection from a finished one.
                onError: (error: SwarmApiError) => {
                    if (error.errorId === SOCKET_FAILED) {
                        return;
                    }
                    set(s => ({
                        error: error.message,
                        forever: false,
                        batch: s.batch.map(item =>
                            item.runId === runId && isUnfinished(item)
                                ? { ...item, status: 'failed' as const, error: error.message }
                                : item
                        )
                    }));
                },
                onClose: info => endRun(runId, info, serverEnded, set)
            }
        );

        liveRuns.set(runId, close);
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
    dismissDisconnected: () => set({ disconnected: false }),

    /** `all` interrupts every session this user has open, not just this tab
     *  (InterruptAll's `other_sessions`, src/WebAPI/BasicAPIFeatures.cs).
     *
     * The API call is what actually stops the work: closing the sockets only stops us watching,
     * which is why it is the request, not the close, that lets the slots be called cancelled. */
    interrupt: (all = false) => {
        for (const close of liveRuns.values()) {
            close();
        }
        set({ running: false, forever: false, disconnected: false });
        api.post('InterruptAll', { other_sessions: all }).catch(() => {
            // The sockets are already closed locally; a failed interrupt call is not worth a toast.
        });
    },

    select: id => set({ selected: id }),
    clearBatch: () => set({ batch: [], selected: null }),
    setForever: on => set({ forever: on }),
    setAutoSwapToImages: on => set({ autoSwapToImages: on }),
    setAutoClearBatch: on => set({ autoClearBatch: on })
}));

/** What this tab's own runs are doing, as the socket reports it. */
export interface RunProgress {
    /** True while any slot of any run is still unfinished. */
    active: boolean;
    /** Slots a backend is working on right now. */
    running: number;
    /** Slots that have not started yet. */
    queued: number;
    /** 0..1 across every slot of the unfinished runs, counting a finished one as whole. Null when
     *  nothing is in flight. */
    percent: number | null;
}

const IDLE: RunProgress = { active: false, running: 0, queued: 0, percent: null };

/** This tab's live run state, for anything that wants to report progress outside the batch rail.
 *
 * The rail's own slots are the most exact account of a run there is: they exist from the moment
 * Generate is pressed, and they distinguish a slot on a backend from one still waiting - neither of
 * which `GetCurrentStatus` can offer, since it is a poll and its `waiting_gens` counts the whole
 * claim, the image currently generating included. */
export function useRunProgress(): RunProgress {
    const batch = useGenerateStore(s => s.batch);
    return useMemo(() => {
        // A run is in flight while any of its slots is unfinished; its finished slots still count
        // towards the percentage, or a four-image run would drop back to 0% after every image.
        const live = new Set<number>();
        for (const item of batch) {
            if (item.status === 'pending' || item.status === 'running') {
                live.add(item.runId);
            }
        }
        if (live.size === 0) {
            return IDLE;
        }
        let running = 0;
        let queued = 0;
        let done = 0;
        let total = 0;
        for (const item of batch) {
            if (!live.has(item.runId)) {
                continue;
            }
            total++;
            if (item.status === 'running') {
                running++;
                done += item.overallPercent ?? 0;
            }
            else if (item.status === 'pending') {
                queued++;
            }
            else {
                // Done, discarded, failed, cancelled or disconnected: nothing more is coming down
                // this socket for the slot either way, and over is over.
                done += 1;
            }
        }
        return { active: true, running, queued, percent: done / total };
    }, [batch]);
}

/** Resolves a batch item's src to something an <img> can load.
 *  Backends return either a relative view path or an inline data URL. */
export function imageUrl(src: string | undefined): string | undefined {
    if (!src) {
        return undefined;
    }
    return src.startsWith('data:') || src.startsWith('http') ? src : `/${src.replace(/^\//, '')}`;
}
