/** Generation run state: the batch rail, the selected image, and the live sockets. */

import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, SOCKET_FAILED, SwarmApiError } from '@/api/client';
import type { StreamClose } from '@/api/client';
import { readUserSetting } from '@/api/queryClient';
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
    /** Resolves once the server has been asked to stop, so a run started after it is not caught
     *  by the same interrupt. */
    interrupt: (all?: boolean) => Promise<void>;
    select: (id: string | null) => void;
    /** Drops a slot from the rail; when it was selected, `next` (or nothing) takes its place. */
    removeItem: (id: string, next: string | null) => void;
    /** Replaces a slot's metadata, eg to record a star. */
    setItemMetadata: (id: string, metadata: string | null) => void;
    clearError: () => void;
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

/** How many slots of this tab's runs are still waiting or generating - what "Generate Forever"
 *  keeps topped up (legacy `num_waiting_gens`). */
export function unfinishedSlotCount(): number {
    let count = 0;
    for (const item of useGenerateStore.getState().batch) {
        if (isUnfinished(item)) {
            count++;
        }
    }
    return count;
}

/** Plays the user's completion sound, if they chose one (site.js playCompletionAudio). */
function playCompletionSound(): void {
    const file = readUserSetting<string>('audio.completionsound', '');
    if (!file) {
        return;
    }
    const audio = new Audio(`/Audio/${file}`);
    audio.volume = Math.min(1, Math.max(0, Number(readUserSetting<unknown>('audio.volume', 0.5)) || 0));
    audio.play().catch(() => {
        // Autoplay policy, or a file that has since been removed: a missing chime is not an error.
    });
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
    const status: BatchItem['status'] = serverEnded || neverStarted ? 'failed' : info.local ? 'cancelled' : 'disconnected';
    // The user setting that drops an interrupted run's unfinished slots instead of leaving them in
    // the rail marked as stopped (ui.removeinterruptedgens, generatehandler.js).
    const removeLeftovers = status === 'cancelled' && readUserSetting<unknown>('ui.removeinterruptedgens', false) === true;
    set(s => {
        // Only worth saying anything if the run still had work outstanding - a socket closing on a
        // run that already delivered everything is just the run ending.
        const outstanding = s.batch.some(item => item.runId === runId && isUnfinished(item));
        const batch: BatchItem[] = removeLeftovers
            ? s.batch.filter(item => item.runId !== runId || !isUnfinished(item))
            : s.batch.map(item =>
                item.runId === runId && isUnfinished(item)
                    ? {
                        ...item,
                        status,
                        error: note ?? item.error,
                        // A preview of an image that will never arrive is a large data URL kept
                        // for nothing; the slot's status says what happened to it.
                        ...(item.isPreview ? { src: undefined, isPreview: false } : {})
                    }
                    : item
            );
        return {
            // Other runs may still be going: this tab is only idle once every socket has closed.
            running: liveRuns.size > 0,
            // A run that could not even connect will fail the same way on the next tick, so
            // "Generate Forever" stops instead of filling the rail with failed slots.
            ...(neverStarted ? { forever: false } : {}),
            // A dropped connection must not re-fire the loop, or a phone coming back from sleep
            // finds a queue of runs nobody asked for.
            ...(outstanding && status === 'disconnected' ? { disconnected: true, forever: false } : {}),
            ...(outstanding && note ? { error: note } : {}),
            ...(s.selected !== null && !batch.some(item => item.id === s.selected) ? { selected: null } : {}),
            batch
        };
    });
}

export const useGenerateStore = create<GenerateStore>()(persist((set, get) => ({
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
            // Only finished slots go: a run still queued or generating keeps its slots, or "Generate
            // Forever" would never see its queue fill and would start a new run on every tick.
            const kept = state.batch.filter(isUnfinished);
            set({ batch: kept, selected: kept.some(item => item.id === state.selected) ? state.selected : null });
        }
        set({ running: true, error: null, inputError: null, disconnected: false, nextRunId: runId + 1 });

        /** Set once the run has been settled, by whichever came first: the server announcing the
         *  end, or the socket closing. */
        let settled = false;
        /** Set when this tab interrupted the run, after which nothing more it says is wanted. */
        let interrupted = false;
        /** Settles the run exactly once. `serverEnded` is what separates "this run finished" from
         *  "this socket stopped talking to us". */
        const finish = (info: StreamClose, serverEnded: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            endRun(runId, info, serverEnded, set);
        };

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
                    if (settled || interrupted) {
                        return;
                    }
                    // The server holds the socket open for two more seconds after this, in case the
                    // page wants to queue more on it (T2IAPI.cs GenT2I). Nothing here does, so the
                    // run is over now - waiting for the close would stall "Generate Forever" and
                    // the Generate button by those two seconds every run.
                    if (message.socket_intention === 'close') {
                        finish({ local: false, opened: true, code: 1000, reason: '' }, true);
                        close();
                        playCompletionSound();
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
                    if (error.errorId === SOCKET_FAILED || settled || interrupted) {
                        return;
                    }
                    set(s => ({
                        error: error.message,
                        forever: false,
                        batch: s.batch.map(item =>
                            item.runId === runId && isUnfinished(item)
                                ? {
                                    ...item,
                                    status: 'failed' as const,
                                    error: error.message,
                                    ...(item.isPreview ? { src: undefined, isPreview: false } : {})
                                }
                                : item
                        )
                    }));
                },
                onClose: info => finish(info, false)
            }
        );

        liveRuns.set(runId, () => {
            interrupted = true;
            close();
        });
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

    /** Stops "generate forever" too, so a bad request cannot re-fire on a loop. Runs already going
     *  are untouched, since a press can now queue behind them. */
    fail: issue => set({ inputError: issue, running: liveRuns.size > 0, forever: false }),
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
        return api.post('InterruptAll', { other_sessions: all }).then(
            () => {},
            () => {
                // The sockets are already closed locally; a failed interrupt call is not worth a toast.
            }
        );
    },

    select: id => set({ selected: id }),
    removeItem: (id, next) =>
        set(s => ({
            batch: s.batch.filter(item => item.id !== id),
            selected: s.selected === id ? next : s.selected
        })),
    setItemMetadata: (id, metadata) =>
        set(s => ({ batch: s.batch.map(item => (item.id === id ? { ...item, metadata } : item)) })),
    clearError: () => set({ error: null }),
    clearBatch: () => set({ batch: [], selected: null }),
    setForever: on => set({ forever: on }),
    setAutoSwapToImages: on => set({ autoSwapToImages: on }),
    setAutoClearBatch: on => set({ autoClearBatch: on })
}), {
    name: 'swarm-ui-generate',
    // Only the user's toggles: everything else is the state of runs that died with the page.
    partialize: state => ({ autoSwapToImages: state.autoSwapToImages, autoClearBatch: state.autoClearBatch })
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
