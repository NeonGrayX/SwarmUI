import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Loader2, X } from 'lucide-react';
import { useJobStore, type Job } from '@/tools/jobs';
import { useTranslation } from '@/i18n';

/** Standard shell for a tool screen: the form leads, the long explanation collapses behind
 *  "About this tool", and the one line that actually matters is promoted to a warning beside the
 *  action. */
export function ToolLayout(props: {
    title: string;
    summary: string;
    /** Long-form explanation, collapsed by default. */
    about?: ReactNode;
    /** Promoted warning shown next to the action. */
    warning?: ReactNode;
    children: ReactNode;
    action?: ReactNode;
}) {
    const { t } = useTranslation();
    const [showAbout, setShowAbout] = useState(false);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="max-w-2xl p-5" style={{ ['--sw-field-label-width' as string]: '11rem' }}>
                    <h1 className="text-base font-medium text-fg-strong">{props.title}</h1>
                    <p className="mt-0.5 mb-4 text-sm text-fg-soft">{props.summary}</p>

                    <div className="rounded-lg border border-default bg-surface p-4">{props.children}</div>

                    {props.warning && <ToolWarning className="mt-3">{props.warning}</ToolWarning>}

                    {props.action && <div className="mt-3 flex justify-end">{props.action}</div>}

                    {props.about && (
                        <div className="mt-4">
                            <button
                                type="button"
                                onClick={() => setShowAbout(o => !o)}
                                aria-expanded={showAbout}
                                className="flex items-center gap-1 rounded px-1 py-0.5 text-sm text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                <ChevronRight
                                    size={14}
                                    aria-hidden
                                    className={`transition-transform ${showAbout ? 'rotate-90' : ''}`}
                                />
                                {t('tools.aboutThisTool')}
                            </button>
                            {showAbout && (
                                <div className="mt-1.5 space-y-2 rounded-lg border border-subtle bg-surface p-3 text-sm text-fg-soft">
                                    {props.about}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <JobPanel />
        </div>
    );
}

/** The promoted warning box, also used by tools drawn outside this layout. */
export function ToolWarning(props: { children: ReactNode; className?: string }) {
    return (
        <div
            className={['flex items-start gap-2 rounded-lg border p-3 text-sm', props.className ?? ''].join(' ')}
            style={{
                borderColor: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 45%, transparent)',
                background: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 12%, transparent)'
            }}
        >
            <AlertTriangle
                size={15}
                aria-hidden
                className="mt-0.5 shrink-0"
                style={{ color: 'var(--status-bar-warn-color-start-end)' }}
            />
            <div className="text-fg">{props.children}</div>
        </div>
    );
}

/** Progress for every running/finished job, shared across all tools. */
export function JobPanel() {
    const { t } = useTranslation();
    const jobs = useJobStore(s => s.jobs);
    const clearFinished = useJobStore(s => s.clearFinished);

    if (jobs.length === 0) {
        return null;
    }

    return (
        <div className="max-h-64 shrink-0 overflow-y-auto border-t border-subtle bg-surface-raised">
            <div className="flex items-center gap-2 px-4 py-1.5">
                <h2 className="text-xs font-medium text-fg-strong">{t('tools.tasks')}</h2>
                <span className="text-xs text-fg-soft">{jobs.length}</span>
                <div className="flex-1" />
                {jobs.some(job => job.status !== 'running') && (
                    <button
                        type="button"
                        onClick={clearFinished}
                        className="rounded px-1.5 py-0.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        {t('tools.clearFinished')}
                    </button>
                )}
            </div>
            <ul className="px-4 pb-2">
                {jobs.map(job => (
                    <JobRow key={job.id} job={job} />
                ))}
            </ul>
        </div>
    );
}

const STATUS_COLOR: Record<Job['status'], string> = {
    running: 'var(--emphasis)',
    done: 'var(--backend-running)',
    failed: 'var(--backend-errored)',
    cancelled: 'var(--sw-fg-soft)'
};

function JobRow(props: { job: Job }) {
    const { t } = useTranslation();
    const { job } = props;
    const cancel = useJobStore(s => s.cancel);
    const dismiss = useJobStore(s => s.dismiss);
    const [expanded, setExpanded] = useState(false);
    const percent = Math.round(job.overallPercent * 100);

    return (
        <li className="border-t border-subtle py-1.5 first:border-t-0">
            <div className="flex items-center gap-2">
                {job.status === 'running' ? (
                    <Loader2 size={13} className="shrink-0 animate-spin text-fg-soft" aria-hidden />
                ) : (
                    <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: STATUS_COLOR[job.status] }}
                    />
                )}
                <button
                    type="button"
                    onClick={() => setExpanded(e => !e)}
                    aria-expanded={expanded}
                    className="min-w-0 flex-1 truncate text-left text-sm text-fg"
                >
                    {job.title}
                </button>
                <span className="shrink-0 text-xs tabular-nums text-fg-soft">
                    {job.status === 'running' ? `${percent}%` : t(`tools.jobStatus.${job.status}`)}
                </span>
                {job.status === 'running' ? (
                    <button
                        type="button"
                        onClick={() => cancel(job.id)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        {t('common.cancel')}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => dismiss(job.id)}
                        aria-label={t('common.dismiss')}
                        className="shrink-0 rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        <X size={12} aria-hidden />
                    </button>
                )}
            </div>

            {job.status === 'running' && (
                <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: 'var(--sw-surface-sunken)' }}>
                    <div
                        className="h-full rounded-full transition-[width]"
                        style={{ width: `${percent}%`, background: 'var(--emphasis)' }}
                    />
                </div>
            )}

            {job.error && (
                <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {job.error}
                </p>
            )}

            {expanded && job.log.length > 0 && (
                <pre className="mt-1.5 max-h-32 overflow-auto rounded border border-subtle bg-surface-sunken p-2 font-mono text-[11px] text-fg-soft">
                    {job.log.join('\n')}
                </pre>
            )}
        </li>
    );
}
