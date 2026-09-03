import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { queryKeys, useCurrentStatus, useSession } from '@/api/hooks';
import { useRunProgress } from '@/generate/store';
import { useTranslation } from '@/i18n';

/** Backend health, as a dismissible alert *inside* the content flow rather than an overlay, so it
 *  can never cover or intercept clicks on the navigation above it. */
export function StatusAlert() {
    const { t, tDynamic } = useTranslation();
    const session = useSession();
    const status = useCurrentStatus(session.isSuccess);
    const [dismissed, setDismissed] = useState<string | null>(null);

    const backend = status.data?.backend_status;
    if (!backend || backend.class === '' || !backend.message) {
        return null;
    }
    if (dismissed === backend.message) {
        return null;
    }

    const isError = backend.class === 'error';
    const Icon = backend.any_loading ? Loader2 : AlertTriangle;

    return (
        <div
            role="status"
            className="flex items-start gap-2 px-4 py-2 border-b text-sm"
            style={{
                background: isError
                    ? 'var(--sw-error-tint)'
                    : 'color-mix(in srgb, var(--status-bar-warn-color-middle) 18%, transparent)',
                borderColor: isError
                    ? 'var(--sw-error-border)'
                    : 'color-mix(in srgb, var(--status-bar-warn-color-middle) 40%, transparent)'
            }}
        >
            <Icon
                size={16}
                className={`mt-0.5 shrink-0 ${backend.any_loading ? 'animate-spin' : ''}`}
                style={{ color: isError ? 'var(--backend-errored)' : 'var(--status-bar-warn-color-start-end)' }}
                aria-hidden
            />
            {/* Backend status messages are server-authored, so they translate by source text. */}
            <p className="flex-1 text-fg">{tDynamic(backend.message)}</p>
            <button
                type="button"
                onClick={() => setDismissed(backend.message)}
                aria-label={t('common.dismiss')}
                className="shrink-0 rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
            >
                <X size={14} aria-hidden />
            </button>
        </div>
    );
}

/** Compact live generation counters for the header, with the progress of this tab's own run.
 *
 * Two sources, in that order of preference. A run started here is known exactly and from the press
 * of the button, because the generation socket reports every slot; the status poll is up to a
 * refetch behind it and cannot tell a slot on a backend from one still waiting. The poll is still
 * what reports a run started in another tab or by another device, so it takes over whenever this
 * tab has nothing of its own in flight. */
export function GenerationCounters() {
    const { t } = useTranslation();
    const session = useSession();
    const status = useCurrentStatus(session.isSuccess);
    const local = useRunProgress();
    const queryClient = useQueryClient();
    const stats = status.data?.status;

    // The idle poll is a minute apart, so without this the header would keep showing a finished
    // run's leftovers - or nothing at all where another session is still going.
    useEffect(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.currentStatus });
    }, [local.active, queryClient]);

    const liveGens = stats?.live_gens ?? 0;
    const running = local.active ? local.running : liveGens;
    // `waiting_gens` is the size of the whole claim, the image on a backend right now included
    // (Session.GenClaim, src/Accounts/Session.cs), so the live ones have to come back off it or
    // the one image being generated is reported as running and queued at the same time.
    const queued = local.active ? local.queued : Math.max(0, (stats?.waiting_gens ?? 0) - liveGens);
    const loadingModels = stats?.loading_models ?? 0;
    const percent = local.percent === null ? null : Math.round(local.percent * 100);

    if (running === 0 && queued === 0 && loadingModels === 0) {
        return null;
    }

    return (
        <span className="flex items-center gap-1.5 text-xs text-fg-soft">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            <span className="whitespace-nowrap">
                {loadingModels > 0
                    ? t('status.loadingModels', { count: loadingModels })
                    : running > 0 && queued > 0
                      ? t('status.generations', { running, queued })
                      : running > 0
                        ? t('status.running', { count: running })
                        : t('status.queued', { count: queued })}
            </span>
            {/* The batch rail carries this per image; here it is the run as a whole, so a glance at
                the header answers "how far in am I" from any screen in the app. */}
            {percent !== null && (
                <span
                    role="progressbar"
                    aria-label={t('generate.generating')}
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1 w-10 shrink-0 overflow-hidden rounded-full"
                    style={{ background: 'var(--sw-surface-sunken)' }}
                >
                    <span
                        className="block h-full rounded-full transition-[width] duration-200"
                        style={{ width: `${percent}%`, background: 'var(--emphasis)' }}
                    />
                </span>
            )}
        </span>
    );
}
