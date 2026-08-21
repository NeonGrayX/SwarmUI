/** Shared job runner for the long-running websocket tools.
 *
 * The legacy versions of these tools report progress only via console.log ("Additional debug info
 * while running can be found in the browser console" — UtilitiesTab.cshtml), so a user running a
 * model download or LoRA extraction has no in-page feedback at all. This gives every such tool one
 * progress bar, one log tail and one cancel button.
 */

import { create } from 'zustand';
import { api, SwarmApiError } from '@/api/client';
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
    /** Starts a websocket-driven job and returns its id. */
    run: (options: { title: string; route: string; payload: Record<string, unknown> }) => string;
    cancel: (id: string) => void;
    dismiss: (id: string) => void;
    clearFinished: () => void;
}

let nextId = 1;

export const useJobStore = create<JobStore>((set, get) => ({
    jobs: [],

    run: ({ title, route, payload }) => {
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

        const close = api.stream<JobMessage>(route, payload, {
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
                    patch({ status: 'done', overallPercent: 1, currentPercent: 1 });
                    appendLog(t('jobs.completed'));
                }
            },
            onError: (error: SwarmApiError) => {
                patch({ status: 'failed', error: error.message });
                appendLog(t('jobs.errorLine', { error: error.message }));
            },
            onClose: () => {
                const job = get().jobs.find(j => j.id === id);
                if (job?.status === 'running') {
                    // The socket closing without a success message means it ended early.
                    patch({ status: 'failed', error: t('jobs.connectionClosed') });
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
                    cancel: close
                }
            ]
        }));

        return id;
    },

    cancel: id => {
        const job = get().jobs.find(j => j.id === id);
        job?.cancel?.();
        set(state => ({
            jobs: state.jobs.map(j => (j.id === id ? { ...j, status: 'cancelled' as const } : j))
        }));
    },

    dismiss: id => set(state => ({ jobs: state.jobs.filter(job => job.id !== id) })),

    clearFinished: () => set(state => ({ jobs: state.jobs.filter(job => job.status === 'running') }))
}));
