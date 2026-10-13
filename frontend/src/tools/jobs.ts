/** Shared job runner for the long-running websocket tools: one progress bar, one log tail and one
 *  cancel button, for every tool that runs a job.
 */

import { create } from 'zustand';
import { api, SOCKET_FAILED, SwarmApiError, type StreamClose } from '@/api/client';
import type { ApiError } from '@/api/types';
import { t } from '@/i18n';

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
    id: string;
    /** Human label, eg 'Download model: sd_xl_base'. */
    title: string;
    status: JobStatus;
    /** 0..1 through the whole task, when the server reports it. */
    overallPercent: number;
    /** 0..1 through the current step. */
    currentPercent: number;
    log: string[];
    error?: string;
    startedAt: number;
    /** Set once cancel was asked for and the server has not yet confirmed it stopped. */
    cancelling?: boolean;
    cancel?: () => void;
}

/** Progress messages these tools emit. Unknown keys are surfaced into the log. */
interface JobMessage {
    overall_percent?: number;
    current_percent?: number;
    success?: boolean;
    status?: string;
    message?: string;
    [key: string]: unknown;
}

interface JobStore {
    jobs: Job[];
    /** Starts a websocket-driven job and returns its id. `onDone` fires once the server reports
     *  success, for refreshing whatever the job changed. */
    run: (options: {
        title: string;
        route: string;
        payload: Record<string, unknown>;
        /** The route listens for `{"signal":"cancel"}` (eg DoModelDownloadWS) and stops its work on
         *  it. Without this, cancelling only closes the socket. */
        signalCancel?: boolean;
        onDone?: () => void;
    }) => string;
    cancel: (id: string) => void;
    dismiss: (id: string) => void;
    clearFinished: () => void;
}

let nextId = 1;

/** How long to wait for the server to confirm a signalled cancel before closing anyway. */
const CANCEL_ACK_TIMEOUT_MS = 10_000;

interface JobSocket {
    /** Sends a JSON message on the open socket. False when it is not open. */
    send: (data: Record<string, unknown>) => boolean;
    close: () => void;
}

/** Same contract as `api.stream`, but hands back a way to send on the socket too, which the
 *  download route needs for its cancel signal. A lapsed session is refreshed through a plain API
 *  call (which renews it as a side effect) and the socket reopened once. */
function openJobSocket<T>(
    route: string,
    body: Record<string, unknown>,
    handlers: {
        onMessage: (data: T) => void;
        onError: (error: SwarmApiError) => void;
        onClose: (info: StreamClose) => void;
    }
): JobSocket {
    let local = false;
    let current: WebSocket | null = null;

    const open = (retried: boolean): void => {
        let opened = false;
        let settled = false;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${protocol}//${window.location.host}/API/${route}`);
        current = socket;
        socket.onopen = () => {
            opened = true;
            socket.send(JSON.stringify({ ...body, session_id: api.sessionData?.session_id }));
        };
        socket.onmessage = event => {
            const data = JSON.parse(event.data) as T & ApiError;
            if (data.error_id === 'invalid_session_id' && !local && !retried) {
                settled = true;
                socket.close();
                api.post('GetMyUserData')
                    .catch(() => undefined)
                    .then(() => {
                        if (local) {
                            handlers.onClose({ local: true, opened, code: 1000, reason: '' });
                            return;
                        }
                        open(true);
                    });
                return;
            }
            if (data.error || data.error_id) {
                handlers.onError(new SwarmApiError(route, data.error ?? t('api.streamFailed', { id: data.error_id ?? '' }), data.error_id));
                return;
            }
            handlers.onMessage(data);
        };
        socket.onerror = () => {
            if (!local && !settled) {
                handlers.onError(new SwarmApiError(route, t('api.socketFailed'), SOCKET_FAILED));
            }
        };
        socket.onclose = event => {
            if (settled) {
                return;
            }
            settled = true;
            handlers.onClose({ local, opened, code: event.code, reason: event.reason });
        };
    };

    open(false);

    return {
        send: data => {
            if (current?.readyState !== WebSocket.OPEN) {
                return false;
            }
            current.send(JSON.stringify(data));
            return true;
        },
        close: () => {
            local = true;
            const socket = current;
            if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                socket.close();
            }
        }
    };
}

export const useJobStore = create<JobStore>((set, get) => ({
    jobs: [],

    run: ({ title, route, payload, signalCancel, onDone }) => {
        const id = `job-${nextId++}`;

        function patch(changes: Partial<Job>) {
            set(state => ({
                jobs: state.jobs.map(job => (job.id === id ? { ...job, ...changes } : job))
            }));
        }
        function appendLog(line: string) {
            set(state => ({
                jobs: state.jobs.map(job =>
                    // Keep the tail bounded; these can run for a long time.
                    job.id === id ? { ...job, log: [...job.log, line].slice(-200) } : job
                )
            }));
        }

        let cancelTimer: ReturnType<typeof setTimeout> | undefined;
        function finishCancel() {
            clearTimeout(cancelTimer);
            // A job that finished (or failed) while the cancel was on its way keeps that outcome.
            if (get().jobs.find(j => j.id === id)?.status === 'running') {
                patch({ status: 'cancelled', cancelling: false });
            }
        }
        function isCancelling(): boolean {
            return Boolean(get().jobs.find(j => j.id === id)?.cancelling);
        }

        const socket = openJobSocket<JobMessage>(route, payload, {
            onMessage: message => {
                if (typeof message.overall_percent === 'number' || typeof message.current_percent === 'number') {
                    patch({
                        overallPercent: message.overall_percent ?? get().jobs.find(j => j.id === id)?.overallPercent ?? 0,
                        currentPercent: message.current_percent ?? 0
                    });
                }
                if (message.status || message.message) {
                    appendLog(String(message.message ?? message.status));
                }
                if (message.success) {
                    clearTimeout(cancelTimer);
                    patch({ status: 'done', cancelling: false, overallPercent: 1, currentPercent: 1 });
                    appendLog(t('jobs.completed'));
                    onDone?.();
                }
            },
            onError: (error: SwarmApiError) => {
                // The server answers a cancel signal with an error ("Download was cancelled."),
                // which is the acknowledgement rather than a failure.
                if (isCancelling()) {
                    appendLog(error.message);
                    finishCancel();
                    socket.close();
                    return;
                }
                patch({ status: 'failed', error: error.message });
                appendLog(t('jobs.errorLine', { error: error.message }));
            },
            onClose: info => {
                const job = get().jobs.find(j => j.id === id);
                if (job?.cancelling) {
                    finishCancel();
                    return;
                }
                if (job?.status === 'running') {
                    // The socket closing without a success message means it ended early - either
                    // because it never reached the server, or because it stopped part way.
                    patch({
                        status: 'failed',
                        error: info.opened ? t('jobs.connectionClosed') : t('api.socketFailed')
                    });
                }
            }
        });

        set(state => ({
            jobs: [
                ...state.jobs,
                {
                    id,
                    title,
                    status: 'running' as const,
                    overallPercent: 0,
                    currentPercent: 0,
                    log: [],
                    startedAt: Date.now(),
                    cancel: () => {
                        // Ask the server to stop and wait for it to say it has; closing straight
                        // away would leave a download running server-side with nobody watching.
                        if (signalCancel && socket.send({ signal: 'cancel' })) {
                            patch({ cancelling: true });
                            appendLog(t('jobs.cancelling'));
                            cancelTimer = setTimeout(() => {
                                socket.close();
                                finishCancel();
                            }, CANCEL_ACK_TIMEOUT_MS);
                            return;
                        }
                        socket.close();
                        finishCancel();
                    }
                }
            ]
        }));

        return id;
    },

    cancel: id => {
        const job = get().jobs.find(j => j.id === id);
        if (!job || job.status !== 'running' || job.cancelling) {
            return;
        }
        job.cancel?.();
    },

    dismiss: id => set(state => ({ jobs: state.jobs.filter(job => job.id !== id) })),

    clearFinished: () => set(state => ({ jobs: state.jobs.filter(job => job.status === 'running') }))
}));
