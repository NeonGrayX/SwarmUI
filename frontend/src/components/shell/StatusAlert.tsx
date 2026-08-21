import { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useCurrentStatus, useSession } from '@/api/hooks';
import { useTranslation } from '@/i18n';

/** Backend health, rendered as a dismissible alert *inside* the content flow.
 *
 * The legacy equivalent (#top_status_bar) is a fixed-position overlay that sits on top of the tab
 * strip — in the running instance it visually clips the tab labels and intercepts their clicks.
 * Keeping this in normal flow removes that class of bug entirely. */
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

/** Compact live generation counters for the header. */
export function GenerationCounters() {
    const { t } = useTranslation();
    const session = useSession();
    const status = useCurrentStatus(session.isSuccess);
    const stats = status.data?.status;
    if (!stats) {
        return null;
    }
    const active = stats.live_gens + stats.waiting_gens;
    if (active === 0 && stats.loading_models === 0) {
        return null;
    }
    return (
        <span className="flex items-center gap-1.5 text-xs text-fg-soft">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            {stats.loading_models > 0
                ? t('status.loadingModels', { count: stats.loading_models })
                : t('status.generations', { running: stats.live_gens, queued: stats.waiting_gens })}
        </span>
    );
}
