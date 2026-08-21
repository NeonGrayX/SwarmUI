import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, Download, Globe, Loader2, Power, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import { useSession } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { fetchLegacyServerInfo, type LegacyServerInfo } from '@/server/legacyInfo';
import { t as translate, useTranslation } from '@/i18n';

interface GpuInfo {
    id: number;
    name: string;
    temperature: number;
    utilization_gpu: number;
    utilization_memory: number;
    total_memory: number;
    free_memory: number;
    used_memory: number;
}

interface ResourceInfo {
    cpu: { usage: number; cores: number };
    system_ram: { total: number; used: number; free: number };
    gpus: Record<string, GpuInfo>;
}

interface ConnectedUser {
    id: string;
    last_active: string;
    last_active_seconds: number;
    active_sessions: { address: string; count: number }[];
    waiting_gens: number;
    loading_models: number;
    waiting_backends: number;
    live_gens: number;
}

interface UpdateTarget {
    count: number;
    preview: string[];
}

interface UpdateCheck {
    /** Absent when the core update check itself failed. */
    server?: UpdateTarget;
    extensions: Record<string, UpdateTarget>;
    backends: Record<string, UpdateTarget>;
}

/** One selectable update, flattened out of the three CheckForUpdates buckets. */
interface UpdateRow {
    key: string;
    kind: 'server' | 'extension' | 'backend';
    /** Name to send back to UpdateAndRestart. Unused for the core. */
    name: string;
    label: string;
    target: UpdateTarget;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) {
        return '—';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Human summary of what a user currently has in flight. Mirrors currentGenString
 *  (src/wwwroot/js/genpage/main.js:61), minus the markup it splices in. */
function genSummary(user: ConnectedUser): string {
    const parts: string[] = [];
    if (user.waiting_gens > 0) {
        parts.push(translate('serverInfo.gen.queued', { count: user.waiting_gens }));
    }
    if (user.live_gens > 0) {
        parts.push(translate('serverInfo.gen.running', { count: user.live_gens }));
    }
    if (user.waiting_backends > 0) {
        parts.push(translate('serverInfo.gen.waitingBackend', { count: user.waiting_backends }));
    }
    if (user.loading_models > 0) {
        parts.push(translate('serverInfo.gen.loadingModel', { count: user.loading_models }));
    }
    return parts.join(', ');
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function ServerInfoPage() {
    const { t } = useTranslation();
    const session = useSession();
    const canRestart = usePermission('restart');
    const canShutdown = usePermission('shutdown');
    const canFreeMemory = usePermission('control_mem_clean');

    // Everything the legacy Server Info tab bakes into its Razor markup instead of serving over the
    // API. Best-effort: if the scrape fails, the rows it feeds are simply absent.
    const legacy = useQuery({
        queryKey: ['legacy-server-info'],
        queryFn: fetchLegacyServerInfo,
        // Only changes across a restart, apart from the update check that runs shortly after boot.
        staleTime: 5 * 60 * 1000,
        retry: false
    });
    const resources = useQuery({
        queryKey: ['server-resources'],
        queryFn: () => api.post<ResourceInfo>('GetServerResourceInfo'),
        refetchInterval: 3000
    });
    const connected = useQuery({
        queryKey: ['connected-users'],
        queryFn: () => api.post<{ users: ConnectedUser[] }>('ListConnectedUsers'),
        refetchInterval: 5000
    });

    const gpus = Object.values(resources.data?.gpus ?? {});
    const ram = resources.data?.system_ram;
    const info = legacy.data;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-2">
                <h1 className="text-sm font-medium text-fg-strong">{t('nav.destination.info')}</h1>
                {info?.version && <span className="text-xs text-fg-soft">v{info.version}</span>}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid max-w-4xl gap-3">
                    <InstallHealth info={info} />

                    <Panel title={t('serverInfo.instance')}>
                        <Row label={t('serverInfo.user')} value={session.data?.user_id ?? '—'} />
                        {info?.version && <Row label={t('serverInfo.version')} value={info.version} />}
                        {info?.gitDate && <Row label={t('serverInfo.currentCommit')} value={info.gitDate} />}
                        <Row label={t('serverInfo.buildId')} value={session.data?.version ?? '—'} />
                        <Row
                            label={t('serverInfo.permissionsGranted')}
                            value={String(session.data?.permissions.length ?? 0)}
                        />
                    </Panel>

                    <NetworkPanel network={info?.network} unavailable={legacy.isError} />

                    <Panel title={t('serverInfo.cpu')}>
                        {resources.data ? (
                            <>
                                <Meter
                                    label={
                                        resources.data.cpu.cores
                                            ? t('serverInfo.usageWithCores', { cores: resources.data.cpu.cores })
                                            : t('serverInfo.usage')
                                    }
                                    percent={resources.data.cpu.usage * 100}
                                    text={`${(resources.data.cpu.usage * 100).toFixed(0)}%`}
                                />
                                {ram && (
                                    <Meter
                                        label={t('serverInfo.systemRam')}
                                        percent={ram.total ? (ram.used / ram.total) * 100 : 0}
                                        text={t('serverInfo.memoryUsage', {
                                            used: formatBytes(ram.used),
                                            total: formatBytes(ram.total),
                                            free: formatBytes(ram.free)
                                        })}
                                    />
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-fg-soft">{t('common.loading')}</p>
                        )}
                    </Panel>

                    <Panel
                        title={
                            gpus.length
                                ? t('serverInfo.gpusWithCount', { count: gpus.length })
                                : t('serverInfo.gpus')
                        }
                    >
                        {resources.isPending ? (
                            <p className="text-sm text-fg-soft">{t('common.loading')}</p>
                        ) : gpus.length === 0 ? (
                            <p className="text-sm text-fg-soft">{t('serverInfo.noGpus')}</p>
                        ) : (
                            gpus.map(gpu => (
                                <div key={gpu.id} className="mb-3 last:mb-0">
                                    <p className="mb-1 text-sm text-fg">
                                        <span className="text-fg-soft">#{gpu.id}</span> {gpu.name}
                                        {gpu.temperature > 0 && (
                                            <span className="ml-2 text-xs text-fg-soft">{gpu.temperature}°C</span>
                                        )}
                                    </p>
                                    <Meter
                                        label={t('serverInfo.utilization')}
                                        percent={gpu.utilization_gpu}
                                        text={t('serverInfo.gpuUtilization', {
                                            core: gpu.utilization_gpu,
                                            memory: gpu.utilization_memory
                                        })}
                                    />
                                    <Meter
                                        label={t('serverInfo.vram')}
                                        percent={gpu.total_memory ? (gpu.used_memory / gpu.total_memory) * 100 : 0}
                                        text={t('serverInfo.memoryUsage', {
                                            used: formatBytes(gpu.used_memory),
                                            total: formatBytes(gpu.total_memory),
                                            free: formatBytes(gpu.free_memory)
                                        })}
                                    />
                                </div>
                            ))
                        )}
                    </Panel>

                    <ConnectedUsersPanel
                        users={connected.data?.users ?? []}
                        pending={connected.isPending}
                    />

                    {canRestart && <UpdatesPanel info={info} />}
                    {canFreeMemory && <FreeMemoryPanel />}
                    {canShutdown && <ShutdownPanel />}
                </div>
            </div>
        </div>
    );
}

/** Warnings about a broken install. Both conditions permanently disable parts of Swarm, so they
 *  lead the page rather than sitting in a card near the bottom like they do in the legacy UI. */
function InstallHealth(props: { info: LegacyServerInfo | undefined }) {
    const { t } = useTranslation();
    const canInstall = usePermission('install');
    const install = useMutation({
        mutationFn: () => api.post('InstallDotnetUpdate')
    });
    const info = props.info;
    if (!info || (!info.dotnetMissing && !info.gitFailed)) {
        return null;
    }
    return (
        <>
            {info.dotnetMissing && (
                <Warning title={t('serverInfo.dotnetMissing', { version: info.dotnetMissing })}>
                    <p>
                        {t('serverInfo.dotnetMissingBody', { version: `${info.dotnetMissing}.0` })}{' '}
                        <a
                            href={`https://dotnet.microsoft.com/en-us/download/dotnet/${info.dotnetMissing}.0`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline"
                        >
                            dotnet.microsoft.com
                        </a>
                        .
                    </p>
                    {info.canInstallDotnet && canInstall && (
                        <button
                            type="button"
                            onClick={() => install.mutate()}
                            disabled={install.isPending || install.isSuccess}
                            className="mt-2 flex items-center gap-1.5 rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50"
                        >
                            {install.isPending && <Loader2 size={12} className="animate-spin" aria-hidden />}
                            {install.isSuccess
                                ? t('serverInfo.dotnetInstalling')
                                : t('serverInfo.dotnetInstall', { version: `${info.dotnetMissing}.0` })}
                        </button>
                    )}
                    {install.isError && (
                        <p className="mt-1" style={{ color: 'var(--backend-errored)' }}>
                            {errorText(install.error)}
                        </p>
                    )}
                </Warning>
            )}
            {info.gitFailed && (
                <Warning title={t('serverInfo.gitFailed')}>
                    <p>
                        {t('serverInfo.gitFailedBody')}{' '}
                        <a
                            href="https://github.com/mcmonkeyprojects/SwarmUI?tab=readme-ov-file#installing-on-windows"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline"
                        >
                            {t('serverInfo.readmeLink')}
                        </a>
                        .
                    </p>
                </Warning>
            )}
        </>
    );
}

function NetworkPanel(props: { network: LegacyServerInfo['network'] | undefined; unavailable: boolean }) {
    const { t } = useTranslation();
    const network = props.network;
    return (
        <Panel title={t('serverInfo.network')}>
            {!network ? (
                <p className="text-sm text-fg-soft">
                    {props.unavailable ? t('serverInfo.networkUnavailable') : t('common.loading')}
                </p>
            ) : network.localOnly ? (
                <p className="text-sm text-fg-soft">{t('serverInfo.localOnly')}</p>
            ) : network.lanAddresses ? (
                <>
                    <p className="text-sm text-fg-soft">{t('serverInfo.lanReachable')}</p>
                    <p className="mt-0.5 break-words font-mono text-sm text-fg">{network.lanAddresses}</p>
                </>
            ) : network.unknownHost ? (
                <p className="text-sm text-fg-soft">
                    {t('serverInfo.unknownHostBefore')}{' '}
                    <span className="font-mono text-fg">{network.unknownHost}</span>
                    {t('serverInfo.unknownHostAfter')}
                </p>
            ) : (
                <p className="text-sm text-fg-soft">{t('serverInfo.networkUnavailable')}</p>
            )}

            {network?.publicUrl && (
                <p className="mt-2 text-sm text-fg-soft">
                    {t('serverInfo.publicReachable')}{' '}
                    <a
                        href={network.publicUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 break-all text-fg underline"
                    >
                        <Globe size={12} aria-hidden className="shrink-0" />
                        {network.publicUrl}
                    </a>
                </p>
            )}
        </Panel>
    );
}

function ConnectedUsersPanel(props: { users: ConnectedUser[]; pending: boolean }) {
    const { t } = useTranslation();
    const canInterrupt = usePermission('interrupt_others');
    const interrupt = useMutation({
        mutationFn: (name: string) => api.post('AdminInterruptUser', { name })
    });

    return (
        <Panel
            title={
                props.users.length
                    ? t('serverInfo.connectedUsersWithCount', { count: props.users.length })
                    : t('serverInfo.connectedUsers')
            }
        >
            {props.pending ? (
                <p className="text-sm text-fg-soft">{t('common.loading')}</p>
            ) : props.users.length === 0 ? (
                <p className="text-sm text-fg-soft">{t('serverInfo.nobodyActive')}</p>
            ) : (
                <ul className="divide-y divide-[var(--light-border)]">
                    {props.users.map(user => {
                        const busy = genSummary(user);
                        return (
                            <li key={user.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                                <span className="w-44 shrink-0 truncate text-fg" title={user.id}>
                                    {user.id}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="text-fg-soft">
                                        {t('serverInfo.activeAgo', { when: user.last_active })}
                                    </span>
                                    {user.active_sessions.length > 0 && (
                                        <span className="block text-xs text-fg-soft opacity-80">
                                            {user.active_sessions
                                                .map(sess =>
                                                    t('serverInfo.sessionsFrom', {
                                                        count: sess.count,
                                                        address: sess.address
                                                    })
                                                )
                                                .join(', ')}
                                        </span>
                                    )}
                                    {busy && <span className="block text-xs text-fg">{busy}</span>}
                                </span>
                                {busy && canInterrupt && (
                                    <button
                                        type="button"
                                        onClick={() => interrupt.mutate(user.id)}
                                        className="shrink-0 rounded border border-default px-2 py-0.5 text-xs"
                                        style={{ color: 'var(--backend-errored)' }}
                                    >
                                        {t('generate.interrupt')}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {interrupt.isError && (
                <p className="mt-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(interrupt.error)}
                </p>
            )}
        </Panel>
    );
}

/** Update checking and applying.
 *
 * The legacy card re-runs the check on every visit to the tab and leaves the result on screen
 * indefinitely; here the check is a query, so it runs once and the button is an explicit refetch.
 * Whether it runs on arrival at all follows the server's own Maintenance.CheckForUpdates setting,
 * same as legacy — each check runs `git fetch` against the core repo, every extension and every
 * backend, so it is not free. */
function UpdatesPanel(props: { info: LegacyServerInfo | undefined }) {
    const { t } = useTranslation();
    const autoCheck = props.info?.autoUpdateCheck;
    const [checkRequested, setCheckRequested] = useState(false);
    const [deselected, setDeselected] = useState<Set<string>>(new Set());
    const [aggressive, setAggressive] = useState(false);
    const [force, setForce] = useState(false);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        if (autoCheck) {
            setCheckRequested(true);
        }
    }, [autoCheck]);

    const updates = useQuery({
        queryKey: ['check-updates'],
        queryFn: () => api.post<UpdateCheck>('CheckForUpdates'),
        enabled: checkRequested,
        // Each check runs `git fetch` against every repo, so never re-run it on its own.
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false
    });

    const apply = useMutation({
        mutationFn: (body: Record<string, unknown>) => api.post<{ result: string }>('UpdateAndRestart', body)
    });

    const rows: UpdateRow[] = [];
    if (updates.data) {
        if (updates.data.server && updates.data.server.count > 0) {
            rows.push({
                key: 'server',
                kind: 'server',
                name: 'server',
                label: t('serverInfo.update.core', { count: updates.data.server.count }),
                target: updates.data.server
            });
        }
        for (const [name, target] of Object.entries(updates.data.extensions ?? {})) {
            rows.push({
                key: `extension:${name}`,
                kind: 'extension',
                name,
                label: t('serverInfo.update.named', { name, count: target.count }),
                target
            });
        }
        for (const [name, target] of Object.entries(updates.data.backends ?? {})) {
            rows.push({
                key: `backend:${name}`,
                kind: 'backend',
                name,
                label: t('serverInfo.update.named', { name, count: target.count }),
                target
            });
        }
    }
    const selected = rows.filter(row => !deselected.has(row.key));
    const canApply = (selected.length > 0 || force) && !apply.isPending;

    const toggleRow = (key: string) =>
        setDeselected(prior => {
            const next = new Set(prior);
            if (next.has(key)) {
                next.delete(key);
            }
            else {
                next.add(key);
            }
            return next;
        });

    const runUpdate = () => {
        apply.mutate({
            doUpdateServer: selected.some(row => row.kind === 'server'),
            extensionsToUpdate: selected.filter(row => row.kind === 'extension').map(row => row.name),
            backendsToUpdate: selected.filter(row => row.kind === 'backend').map(row => row.name),
            aggressive,
            force
        });
    };

    return (
        <Panel title={t('serverInfo.updates')}>
            {props.info?.update && (
                <p className="mb-2 whitespace-pre-wrap text-sm text-fg">
                    {props.info.update.url ? (
                        <>
                            {props.info.update.message.split('\n')[0]}{' '}
                            <a
                                href={props.info.update.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="underline"
                            >
                                {t('serverInfo.releaseNotes')}
                            </a>
                        </>
                    ) : (
                        props.info.update.message
                    )}
                </p>
            )}

            {!checkRequested ? (
                <p className="mb-2 text-sm text-fg-soft">
                    {autoCheck === false
                        ? t('serverInfo.autoCheckDisabled')
                        : t('serverInfo.notCheckedYet')}
                </p>
            ) : updates.isFetching ? (
                <p className="mb-2 flex items-center gap-1.5 text-sm text-fg-soft">
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                    {t('serverInfo.checkingUpdates')}
                </p>
            ) : updates.isError ? (
                <p className="mb-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(updates.error)}
                </p>
            ) : rows.length === 0 ? (
                <p className="mb-2 text-sm text-fg-soft">{t('serverInfo.noUpdates')}</p>
            ) : (
                <ul className="mb-3 space-y-1.5">
                    {rows.map(row => (
                        <li key={row.key}>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={!deselected.has(row.key)}
                                    onChange={() => toggleRow(row.key)}
                                    className="mt-1 accent-[var(--emphasis)]"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="text-fg">{row.label}</span>
                                    <span className="mt-0.5 block whitespace-pre-wrap break-words font-mono text-[11px] leading-tight text-fg-soft">
                                        {row.target.preview
                                            .map(line => (line.length > 100 ? `${line.slice(0, 97)}…` : line))
                                            .join('\n')}
                                    </span>
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Toggle
                    label={t('serverInfo.aggressiveUpdate')}
                    title={t('serverInfo.aggressiveUpdateHint')}
                    checked={aggressive}
                    onChange={setAggressive}
                />
                <Toggle
                    label={t('serverInfo.forceRestart')}
                    title={t('serverInfo.forceRestartHint')}
                    checked={force}
                    onChange={setForce}
                />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => {
                        setDeselected(new Set());
                        if (checkRequested) {
                            updates.refetch();
                        }
                        else {
                            setCheckRequested(true);
                        }
                    }}
                    disabled={updates.isFetching}
                    className="flex items-center gap-1.5 rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50"
                >
                    <RefreshCw size={12} className={updates.isFetching ? 'animate-spin' : ''} aria-hidden />
                    {t('serverInfo.checkForUpdates')}
                </button>
                <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={!canApply}
                    className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs disabled:opacity-50"
                    style={{
                        background: 'var(--danger-button-background)',
                        color: 'var(--danger-button-foreground)'
                    }}
                >
                    <Download size={12} aria-hidden />
                    {t('serverInfo.updateAndRestart')}
                </button>
            </div>

            {apply.isPending && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-soft">
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                    {t('serverInfo.applyingUpdates')}
                </p>
            )}
            {apply.isError && (
                <p className="mt-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(apply.error)}
                </p>
            )}
            {apply.data && <p className="mt-2 text-sm text-fg">{apply.data.result}</p>}

            <ConfirmDialog
                open={confirming}
                title={t('serverInfo.updateConfirmTitle')}
                body={
                    <>
                        {selected.length > 0
                            ? t('serverInfo.updateConfirmSelected', { count: selected.length })
                            : t('serverInfo.updateConfirmForced')}{' '}
                        {t('serverInfo.updateConfirmWarning')}
                    </>
                }
                confirmLabel={t('serverInfo.updateAndRestart')}
                destructive
                onConfirm={() => {
                    setConfirming(false);
                    runUpdate();
                }}
                onCancel={() => setConfirming(false)}
            />
        </Panel>
    );
}

function FreeMemoryPanel() {
    const { t } = useTranslation();
    const free = useMutation({
        mutationFn: (systemRam: boolean) => api.post('FreeBackendMemory', { system_ram: systemRam })
    });

    return (
        <Panel title={t('serverInfo.freeMemory')}>
            <p className="mb-2 text-sm text-fg-soft">{t('serverInfo.freeMemoryNote')}</p>
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => free.mutate(false)}
                    disabled={free.isPending}
                    className="rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50"
                >
                    {t('serverInfo.freeVram')}
                </button>
                <button
                    type="button"
                    onClick={() => free.mutate(true)}
                    disabled={free.isPending}
                    className="rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50"
                >
                    {t('serverInfo.freeSystemRam')}
                </button>
            </div>
            {free.isError && (
                <p className="mt-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(free.error)}
                </p>
            )}
            {free.isSuccess && (
                <p className="mt-2 text-sm text-fg-soft">
                    {free.variables
                        ? t('serverInfo.freedSystemRam')
                        : t('serverInfo.freedVram')}
                </p>
            )}
        </Panel>
    );
}

function ShutdownPanel() {
    const { t } = useTranslation();
    const [confirming, setConfirming] = useState(false);
    const shutdown = useMutation({
        mutationFn: () => api.post('ShutdownServer')
    });

    return (
        <Panel title={t('serverInfo.shutdown')}>
            <p className="mb-2 text-sm text-fg-soft">{t('serverInfo.shutdownNote')}</p>
            <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={shutdown.isPending || shutdown.isSuccess}
                className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs disabled:opacity-50"
                style={{
                    background: 'var(--danger-button-background)',
                    color: 'var(--danger-button-foreground)'
                }}
            >
                <Power size={12} aria-hidden />
                {t('serverInfo.shutDownServer')}
            </button>
            {shutdown.isError && (
                <p className="mt-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(shutdown.error)}
                </p>
            )}
            {shutdown.isSuccess && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-soft">
                    <Ban size={13} aria-hidden />
                    {t('serverInfo.shuttingDown')}
                </p>
            )}

            <ConfirmDialog
                open={confirming}
                title={t('serverInfo.shutdownConfirmTitle')}
                body={t('serverInfo.shutdownConfirmBody')}
                confirmLabel={t('serverInfo.shutDown')}
                destructive
                onConfirm={() => {
                    setConfirming(false);
                    shutdown.mutate();
                }}
                onCancel={() => setConfirming(false)}
            />
        </Panel>
    );
}

function Panel(props: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-default bg-surface p-4">
            <h2 className="mb-2 text-sm font-medium text-fg-strong">{props.title}</h2>
            {props.children}
        </section>
    );
}

function Warning(props: { title: string; children: React.ReactNode }) {
    return (
        <section
            className="flex items-start gap-2 rounded-lg border p-3 text-sm"
            style={{ borderColor: 'var(--sw-error-border)', background: 'var(--sw-error-tint)' }}
            role="alert"
        >
            <AlertTriangle
                size={15}
                aria-hidden
                className="mt-0.5 shrink-0"
                style={{ color: 'var(--backend-errored)' }}
            />
            <div className="min-w-0 flex-1 text-fg">
                <p className="font-medium text-fg-strong">{props.title}</p>
                {props.children}
            </div>
        </section>
    );
}

function Row(props: { label: string; value: string }) {
    return (
        <div className="flex gap-3 py-0.5 text-sm">
            <span className="w-44 shrink-0 text-fg-soft">{props.label}</span>
            <span className="min-w-0 flex-1 break-words text-fg">{props.value}</span>
        </div>
    );
}

function Toggle(props: { label: string; title: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg" title={props.title}>
            <input
                type="checkbox"
                checked={props.checked}
                onChange={e => props.onChange(e.target.checked)}
                className="accent-[var(--emphasis)]"
            />
            {props.label}
        </label>
    );
}

function Meter(props: { label: string; percent: number; text: string }) {
    const pct = Math.min(100, Math.max(0, props.percent));
    return (
        <div className="mb-1.5 last:mb-0">
            <div className="mb-0.5 flex items-baseline gap-2 text-xs">
                <span className="w-44 shrink-0 text-fg-soft">{props.label}</span>
                <span className="text-fg tabular-nums">{props.text}</span>
            </div>
            <div className="ml-44 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--sw-surface-sunken)' }}>
                <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                        width: `${pct}%`,
                        background: pct > 90 ? 'var(--backend-errored)' : 'var(--emphasis)'
                    }}
                />
            </div>
        </div>
    );
}
