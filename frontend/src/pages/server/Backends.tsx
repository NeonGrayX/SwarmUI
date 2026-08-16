import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Backend {
    type: string;
    status: string;
    id: number;
    settings: Record<string, unknown>;
    features: string[];
    enabled: boolean;
    title: string;
    max_usages: number;
    time_since_used: string;
    can_load_models?: boolean;
    current_model?: string;
}

interface BackendType {
    id: string;
    name: string;
    description: string;
    is_standard: boolean;
}

/** Backend status maps onto the --backend-* theme variables the legacy CSS already defines. */
const STATUS_COLOR: Record<string, string> = {
    running: 'var(--backend-running)',
    idle: 'var(--backend-idle)',
    loading: 'var(--backend-loading)',
    waiting: 'var(--backend-waiting)',
    disabled: 'var(--backend-disabled)',
    errored: 'var(--backend-errored)'
};

export function BackendsPage() {
    const queryClient = useQueryClient();
    const canEdit = usePermission('edit_backends');
    const canAddRemove = usePermission('add_remove_backends');
    const canRestart = usePermission('restart_backends');
    const [pendingDelete, setPendingDelete] = useState<number | null>(null);

    const backends = useQuery({
        queryKey: ['backends'],
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', { full_data: true }),
        refetchInterval: 5000
    });

    const types = useQuery({
        queryKey: ['backend-types'],
        queryFn: () => api.post<{ list: BackendType[] }>('ListBackendTypes')
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['backends'] });

    const toggle = useMutation({
        mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
            api.post('ToggleBackend', { backend_id: id, enabled }),
        onSuccess: invalidate
    });
    const remove = useMutation({
        mutationFn: (id: number) => api.post('DeleteBackend', { backend_id: id }),
        onSuccess: invalidate
    });
    const add = useMutation({
        mutationFn: (type: string) => api.post('AddNewBackend', { type_id: type }),
        onSuccess: invalidate
    });
    const restartAll = useMutation({
        mutationFn: () => api.post('RestartBackends', {}),
        onSuccess: invalidate
    });

    const list = Object.values(backends.data ?? {});

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-2">
                <h1 className="text-sm font-medium text-fg-strong">Backends</h1>
                <span className="text-xs text-fg-soft">{list.length}</span>
                <div className="flex-1" />
                {canRestart && (
                    <button
                        type="button"
                        onClick={() => restartAll.mutate()}
                        disabled={restartAll.isPending}
                        className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        <RefreshCw size={12} className={restartAll.isPending ? 'animate-spin' : ''} aria-hidden />
                        Restart all
                    </button>
                )}
                {canAddRemove && (
                    <Popover.Root>
                        <Popover.Trigger asChild>
                            <button
                                type="button"
                                className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs"
                                style={{ background: 'var(--emphasis)', color: 'var(--emphasis-text)' }}
                            >
                                <Plus size={13} aria-hidden />
                                Add backend
                            </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content
                                side="bottom"
                                align="end"
                                sideOffset={6}
                                className="z-50 max-h-80 w-80 overflow-y-auto rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                            >
                                {(types.data?.list ?? []).map(type => (
                                    <Popover.Close asChild key={type.id}>
                                        <button
                                            type="button"
                                            onClick={() => add.mutate(type.id)}
                                            className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--sw-hover)]"
                                        >
                                            <span className="block text-sm text-fg">{type.name}</span>
                                            <span className="block text-xs text-fg-soft">{type.description}</span>
                                        </button>
                                    </Popover.Close>
                                ))}
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {backends.isPending ? (
                    <p className="text-sm text-fg-soft">Loading backends…</p>
                ) : list.length === 0 ? (
                    <div className="mx-auto max-w-md rounded-lg border border-default bg-surface p-5 text-center">
                        <p className="text-fg">No backends configured.</p>
                        <p className="mt-1 text-sm text-fg-soft">
                            Swarm needs at least one backend to generate images. Add a
                            ComfyUI Self-Starting backend to get going.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {list.map(backend => (
                            <li
                                key={backend.id}
                                className="flex items-start gap-3 rounded-lg border border-default bg-surface p-3"
                            >
                                <span
                                    title={backend.status}
                                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                                    style={{ background: STATUS_COLOR[backend.status] ?? 'var(--gray)' }}
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-fg-strong">
                                        {backend.title || backend.type}{' '}
                                        <span className="text-xs text-fg-soft">#{backend.id}</span>
                                    </p>
                                    <p className="text-xs text-fg-soft">
                                        {backend.type} · {backend.status}
                                        {backend.current_model && ` · ${backend.current_model}`}
                                        {` · last used ${backend.time_since_used}`}
                                    </p>
                                    {backend.features.length > 0 && (
                                        <p className="mt-1 truncate text-[11px] text-fg-soft opacity-70">
                                            {backend.features.length} features
                                        </p>
                                    )}
                                </div>
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={() => toggle.mutate({ id: backend.id, enabled: !backend.enabled })}
                                        aria-label={backend.enabled ? 'Disable backend' : 'Enable backend'}
                                        title={backend.enabled ? 'Disable' : 'Enable'}
                                        className="shrink-0 rounded border border-default p-1.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                                        style={backend.enabled ? { color: 'var(--backend-running)' } : undefined}
                                    >
                                        <Power size={14} aria-hidden />
                                    </button>
                                )}
                                {canAddRemove && (
                                    <button
                                        type="button"
                                        onClick={() => setPendingDelete(backend.id)}
                                        aria-label="Delete backend"
                                        title="Delete backend"
                                        className="shrink-0 rounded border border-default p-1.5 hover:bg-[var(--sw-hover)]"
                                        style={{ color: 'var(--backend-errored)' }}
                                    >
                                        <Trash2 size={14} aria-hidden />
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Delete backend?"
                body={<>Backend #{pendingDelete} will be removed. Any running generations on it will stop.</>}
                confirmLabel="Delete"
                destructive
                onConfirm={() => {
                    if (pendingDelete !== null) {
                        remove.mutate(pendingDelete);
                    }
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}
