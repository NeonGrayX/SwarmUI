import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Loader2, Power, RefreshCw, Search, X } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    fetchLegacyExtensions,
    type ExtensionEntry,
    type ExtensionTag,
    type InstalledExtension
} from '@/server/legacyExtensions';
import { useTranslation } from '@/i18n';

const INPUT =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';
const BUTTON =
    'flex items-center gap-1.5 rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50';
const DANGER_BUTTON = 'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs disabled:opacity-50';
const DANGER_STYLE = {
    background: 'var(--danger-button-background)',
    color: 'var(--danger-button-foreground)'
};

type Action = 'install' | 'update' | 'uninstall' | 'enable' | 'disable';

/** Where one row stands. None of these actions touch the running server — the extension lists only
 *  change across a restart — so, as in the legacy tab, a finished action replaces the row's buttons
 *  with a note saying so instead of refetching a list that would read back unchanged. */
interface RowState {
    pending?: Action;
    done?: Action;
    /** UpdateExtension found nothing to pull. Not final: the buttons stay. */
    noUpdate?: boolean;
    error?: { action: Action; message: string };
}

interface PendingUninstall {
    key: string;
    name: string;
    actionName: string;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function matches(ext: ExtensionEntry, query: string): boolean {
    if (!query) {
        return true;
    }
    return [ext.name, ext.author, ext.description, ext.license, ...ext.tags.map(tag => tag.label)].some(
        field => field.toLowerCase().includes(query)
    );
}

export function ExtensionsPage() {
    const { t } = useTranslation();
    const canRestart = usePermission('restart');
    const [filter, setFilter] = useState('');
    const [rows, setRows] = useState<Record<string, RowState>>({});
    const [restartNeeded, setRestartNeeded] = useState(false);
    const [pendingUninstall, setPendingUninstall] = useState<PendingUninstall | null>(null);

    // Rendered into the legacy page rather than served over the API; see legacyExtensions.
    const extensions = useQuery({
        queryKey: ['legacy-extensions'],
        queryFn: fetchLegacyExtensions,
        // Only changes across a restart, which is exactly when a page reload happens anyway.
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false
    });

    // Legacy's "Restart Now" (extensionsManager.restartServer): a forced UpdateAndRestart, which
    // restarts without requiring anything to have been updated.
    const restart = useMutation({
        mutationFn: () => api.post('UpdateAndRestart', { force: true })
    });

    const run = async (key: string, action: Action, actionName: string) => {
        setRows(prior => ({ ...prior, [key]: { pending: action } }));
        try {
            let changed = true;
            if (action === 'install') {
                await api.post('InstallExtension', { extensionName: actionName });
            }
            else if (action === 'update') {
                const result = await api.post<{ success: boolean }>('UpdateExtension', {
                    extensionName: actionName
                });
                changed = result.success;
            }
            else if (action === 'uninstall') {
                await api.post('UninstallExtension', { extensionName: actionName });
            }
            else {
                await api.post('SetExtensionEnabled', {
                    extensionName: actionName,
                    enabled: action === 'enable'
                });
            }
            setRows(prior => ({ ...prior, [key]: changed ? { done: action } : { noUpdate: true } }));
            if (changed) {
                setRestartNeeded(true);
            }
        }
        catch (error) {
            setRows(prior => ({ ...prior, [key]: { error: { action, message: errorText(error) } } }));
        }
    };

    const query = filter.trim().toLowerCase();
    const installed = (extensions.data?.installed ?? []).filter(ext => matches(ext, query));
    const available = (extensions.data?.available ?? []).filter(ext => matches(ext, query));

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-2">
                <h1 className="text-sm font-medium text-fg-strong">{t('nav.destination.extensions')}</h1>
                {extensions.data && (
                    <span className="text-xs text-fg-soft">{extensions.data.installed.length}</span>
                )}

                <div className="relative min-w-40 max-w-xs flex-1">
                    <Search
                        size={14}
                        aria-hidden
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                    />
                    <input
                        type="search"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        placeholder={t('extensions.filterPlaceholder')}
                        aria-label={t('extensions.filterLabel')}
                        className={`${INPUT} w-full py-1 pl-7 pr-6`}
                    />
                    {filter && (
                        <button
                            type="button"
                            onClick={() => setFilter('')}
                            aria-label={t('common.clearSearch')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                        >
                            <X size={12} aria-hidden />
                        </button>
                    )}
                </div>

                <div className="flex-1" />

                <button
                    type="button"
                    onClick={() => extensions.refetch()}
                    disabled={extensions.isFetching}
                    className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg disabled:opacity-50"
                >
                    <RefreshCw size={12} className={extensions.isFetching ? 'animate-spin' : ''} aria-hidden />
                    {t('common.reload')}
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid max-w-5xl gap-4">
                    {restartNeeded && (
                        <section
                            className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
                            style={{
                                borderColor: 'var(--backend-disabled)',
                                background: 'color-mix(in srgb, var(--backend-disabled) 8%, transparent)'
                            }}
                            role="status"
                        >
                            <div className="min-w-0 flex-1 text-fg">
                                <p className="font-medium text-fg-strong">{t('extensions.restartTitle')}</p>
                                <p className="text-fg-soft">
                                    {canRestart ? t('extensions.restartBody') : t('extensions.restartBodyNoPermission')}
                                </p>
                                {restart.isSuccess && (
                                    <p className="mt-1 flex items-center gap-1.5 text-fg">
                                        <Loader2 size={13} className="animate-spin" aria-hidden />
                                        {t('extensions.restarting')}
                                    </p>
                                )}
                                {restart.isError && (
                                    <p className="mt-1" style={{ color: 'var(--backend-errored)' }}>
                                        {errorText(restart.error)}
                                    </p>
                                )}
                            </div>
                            {canRestart && (
                                <button
                                    type="button"
                                    onClick={() => restart.mutate()}
                                    disabled={restart.isPending || restart.isSuccess}
                                    className={DANGER_BUTTON}
                                    style={DANGER_STYLE}
                                >
                                    <Power size={12} aria-hidden />
                                    {t('extensions.restartNow')}
                                </button>
                            )}
                        </section>
                    )}

                    {extensions.isPending ? (
                        <p className="flex items-center gap-1.5 text-sm text-fg-soft">
                            <Loader2 size={13} className="animate-spin" aria-hidden />
                            {t('common.loading')}
                        </p>
                    ) : extensions.isError ? (
                        <p className="text-sm" style={{ color: 'var(--backend-errored)' }}>
                            {t('extensions.unavailable', { error: errorText(extensions.error) })}
                        </p>
                    ) : (
                        <>
                            <Section
                                title={t('extensions.installed')}
                                count={installed.length}
                                empty={query ? t('extensions.noMatches') : t('extensions.noneInstalled')}
                            >
                                {installed.map(ext => {
                                    const key = `installed:${ext.actionName}`;
                                    return (
                                        <InstalledRow
                                            key={key}
                                            ext={ext}
                                            state={rows[key] ?? {}}
                                            onRun={action => run(key, action, ext.actionName)}
                                            onUninstall={() =>
                                                setPendingUninstall({ key, name: ext.name, actionName: ext.actionName })
                                            }
                                        />
                                    );
                                })}
                            </Section>

                            <Section
                                title={t('extensions.available')}
                                count={available.length}
                                empty={query ? t('extensions.noMatches') : t('extensions.noneAvailable')}
                            >
                                {available.map(ext => {
                                    const key = `available:${ext.actionName}`;
                                    return (
                                        <AvailableRow
                                            key={key}
                                            ext={ext}
                                            state={rows[key] ?? {}}
                                            onInstall={() => run(key, 'install', ext.actionName)}
                                        />
                                    );
                                })}
                            </Section>
                        </>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={pendingUninstall !== null}
                title={t('extensions.uninstallConfirmTitle')}
                body={t('extensions.uninstallConfirmBody', { name: pendingUninstall?.name ?? '' })}
                confirmLabel={t('extensions.uninstall')}
                destructive
                onConfirm={() => {
                    if (pendingUninstall) {
                        run(pendingUninstall.key, 'uninstall', pendingUninstall.actionName);
                    }
                    setPendingUninstall(null);
                }}
                onCancel={() => setPendingUninstall(null)}
            />
        </div>
    );
}

function Section(props: { title: string; count: number; empty: string; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="mb-2 flex items-baseline gap-2 text-sm font-medium text-fg-strong">
                {props.title}
                <span className="text-xs font-normal text-fg-soft">{props.count}</span>
            </h2>
            {props.count === 0 ? (
                <p className="text-sm text-fg-soft">{props.empty}</p>
            ) : (
                <ul className="grid gap-2">{props.children}</ul>
            )}
        </section>
    );
}

function InstalledRow(props: {
    ext: InstalledExtension;
    state: RowState;
    onRun: (action: 'update' | 'enable' | 'disable') => void;
    onUninstall: () => void;
}) {
    const { t } = useTranslation();
    const { ext, state } = props;
    const busy = state.pending !== undefined;
    return (
        <ExtensionCard
            ext={ext}
            badges={
                <>
                    {ext.version && <code className="text-[11px] text-fg-soft">{ext.version}</code>}
                    {!ext.enabled && <Chip kind="hidden">{t('extensions.disabled')}</Chip>}
                </>
            }
            notice={
                ext.oldRepo && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs" style={{ color: 'var(--backend-errored)' }}>
                        <AlertTriangle size={13} aria-hidden className="mt-px shrink-0" />
                        {t('extensions.oldRepo')}
                    </p>
                )
            }
            state={state}
            actions={
                <>
                    {ext.enabled ? (
                        <button
                            type="button"
                            onClick={() => props.onRun('disable')}
                            disabled={busy}
                            className={DANGER_BUTTON}
                            style={DANGER_STYLE}
                        >
                            {t('common.disable')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => props.onRun('enable')}
                            disabled={busy}
                            className={BUTTON}
                        >
                            {t('common.enable')}
                        </button>
                    )}
                    {ext.canUpdate && (
                        <button
                            type="button"
                            onClick={() => props.onRun('update')}
                            disabled={busy}
                            className={BUTTON}
                        >
                            {t('extensions.update')}
                        </button>
                    )}
                    <button type="button" onClick={props.onUninstall} disabled={busy} className={BUTTON}>
                        {t('extensions.uninstall')}
                    </button>
                </>
            }
        />
    );
}

function AvailableRow(props: { ext: ExtensionEntry; state: RowState; onInstall: () => void }) {
    const { t } = useTranslation();
    return (
        <ExtensionCard
            ext={props.ext}
            state={props.state}
            actions={
                <button
                    type="button"
                    onClick={props.onInstall}
                    disabled={props.state.pending !== undefined}
                    className={BUTTON}
                >
                    {t('extensions.install')}
                </button>
            }
        />
    );
}

/** One extension: what it is on the left, what can be done with it on the right. */
function ExtensionCard(props: {
    ext: ExtensionEntry;
    state: RowState;
    badges?: React.ReactNode;
    notice?: React.ReactNode;
    actions: React.ReactNode;
}) {
    const { t, tDynamic } = useTranslation();
    const { ext, state } = props;
    return (
        <li className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-default bg-surface p-3">
            <div className="min-w-0 flex-1 basis-80">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-fg-strong">{ext.name}</span>
                    {props.badges}
                    {ext.tags.map(tag => (
                        <TagChip key={tag.label} tag={tag} />
                    ))}
                </div>
                {ext.description && <p className="mt-1 text-sm text-fg">{tDynamic(ext.description)}</p>}
                {props.notice}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-soft">
                    {ext.author && <span>{t('extensions.byAuthor', { author: ext.author })}</span>}
                    <span
                        className={ext.licenseWarning ? 'rounded px-1' : undefined}
                        style={
                            ext.licenseWarning
                                ? { background: 'var(--sw-error-tint)', color: 'var(--backend-errored)' }
                                : undefined
                        }
                        title={ext.licenseWarning ? t('extensions.licenseWarning') : undefined}
                    >
                        {t('extensions.license', { license: ext.license || '—' })}
                    </span>
                    {ext.readmeUrl ? (
                        <a
                            href={ext.readmeUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="flex items-center gap-1 underline hover:text-fg"
                        >
                            {t('extensions.readme')}
                            <ExternalLink size={11} aria-hidden />
                        </a>
                    ) : (
                        <span>{t('extensions.noReadme')}</span>
                    )}
                </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
                {state.done ? (
                    <p className="text-xs text-fg">{t(`extensions.done.${state.done}`)}</p>
                ) : (
                    <div className="flex flex-wrap justify-end gap-2">{props.actions}</div>
                )}
                {state.pending && (
                    <p className="flex items-center gap-1.5 text-xs text-fg-soft">
                        <Loader2 size={12} className="animate-spin" aria-hidden />
                        {t(`extensions.pending.${state.pending}`)}
                    </p>
                )}
                {state.noUpdate && <p className="text-xs text-fg-soft">{t('extensions.noUpdate')}</p>}
                {state.error && (
                    <p className="max-w-xs text-right text-xs" style={{ color: 'var(--backend-errored)' }}>
                        {t(`extensions.error.${state.error.action}`, { error: state.error.message })}
                    </p>
                )}
            </div>
        </li>
    );
}

function TagChip(props: { tag: ExtensionTag }) {
    return (
        <Chip kind={props.tag.kind} title={props.tag.hint}>
            {props.tag.label}
        </Chip>
    );
}

function Chip(props: { kind: ExtensionTag['kind']; title?: string; children: React.ReactNode }) {
    const color =
        props.kind === 'caution'
            ? 'var(--backend-disabled)'
            : props.kind === 'paid'
              ? 'var(--backend-errored)'
              : undefined;
    return (
        <span
            title={props.title}
            className="rounded border px-1.5 text-[11px] leading-4"
            style={
                color
                    ? { borderColor: color, color }
                    : {
                          borderColor: 'var(--border-color)',
                          color: 'var(--sw-fg-soft)',
                          opacity: props.kind === 'hidden' ? 0.8 : undefined
                      }
            }
        >
            {props.children}
        </span>
    );
}
