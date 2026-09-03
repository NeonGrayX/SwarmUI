import { Link } from '@tanstack/react-router';
import { PlugZap, X } from 'lucide-react';
import { useGenerateStore } from '@/generate/store';
import { useTranslation } from '@/i18n';

/** Says that a run's connection dropped, and that this is not the same as the run failing.
 *
 * Rendered wherever a run is being watched rather than only over the canvas: on a narrow screen
 * the panes are tabs, and someone watching the batch rail would never see a canvas overlay - which
 * is exactly the case this notice exists for, since a phone switching apps is what drops the
 * connection in the first place. */
export function DisconnectedNotice(props: { className?: string }) {
    const { t } = useTranslation();
    const disconnected = useGenerateStore(s => s.disconnected);
    const dismiss = useGenerateStore(s => s.dismissDisconnected);

    if (!disconnected) {
        return null;
    }
    return (
        <div
            role="status"
            className={`flex items-start gap-2 rounded border border-default bg-surface-raised p-2.5 text-sm text-fg shadow-lg ${props.className ?? ''}`}
        >
            <PlugZap size={16} className="mt-0.5 shrink-0 text-fg-soft" aria-hidden />
            <p className="flex-1">
                {t('canvas.disconnected')}{' '}
                <Link
                    to="/library/history"
                    onClick={dismiss}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--emphasis)' }}
                >
                    {t('canvas.disconnectedHistory')}
                </Link>
            </p>
            <button
                type="button"
                onClick={dismiss}
                aria-label={t('common.dismiss')}
                title={t('common.dismiss')}
                className="shrink-0 rounded p-0.5 text-fg-soft hover:text-fg"
            >
                <X size={14} aria-hidden />
            </button>
        </div>
    );
}
