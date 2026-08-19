import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BackendCard, type BackendSaveInput } from '@/components/server/BackendCard';
import { backendLogName, type Backend, type BackendType } from '@/server/backends';

export function BackendsPage() {
    const queryClient = useQueryClient();
    const perms = {
        edit: usePermission('edit_backends'),
        // Toggling is its own permission (Permissions.ToggleBackends, src/Accounts/Permissions.cs:64)
        // and is not implied by edit_backends.
        toggle: usePermission('toggle_backends'),
        addRemove: usePermission('add_remove_backends'),
        restart: usePermission('restart_backends')
    };
    const canViewLogs = usePermission('view_logs');

    const [pendingDelete, setPendingDelete] = useState<number | null>(null);
    const [pendingRestart, setPendingRestart] = useState<number | 'all' | null>(null);
    const [pendingAdd, setPendingAdd] = useState<BackendType | null>(null);
    const [showAdvancedTypes, setShowAdvancedTypes] = useState(false);
    const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});

    const backends = useQuery({
        queryKey: ['backends'],
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', { full_data: true }),
        refetchInterval: 5000
    });

    const types = useQuery({
        queryKey: ['backend-types'],
        queryFn: () => api.post<{ list: BackendType[] }>('ListBackendTypes')
    });

    // Only needed to decide whether a backend has a viewable process log; cheap and static-ish.
    const logTypes = useQuery({
        queryKey: ['log-types'],
        queryFn: () =>
            api.post<{ types_available: { name: string; identifier: string }[] }>('ListLogTypes'),
        enabled: canViewLogs,
        refetchInterval: 30000
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['backends'] });
    // Every one of these can be refused by the server — Program.LockSettings alone rejects add,
    // delete, edit and restart. Legacy swallows the result, so a locked server looks like a dead
    // button; surface it instead. (Per-backend save errors render inside the card.)
    const [actionError, setActionError] = useState<string | null>(null);
    const failWith = (what: string) => (error: unknown) =>
        setActionError(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    const succeed = () => {
        setActionError(null);
        return invalidate();
    };

    const toggle = useMutation({
        mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
            api.post('ToggleBackend', { backend_id: id, enabled }),
        onSuccess: succeed,
        onError: failWith('Could not toggle backend')
    });
    const remove = useMutation({
        mutationFn: (id: number) => api.post('DeleteBackend', { backend_id: id }),
        onSuccess: succeed,
        onError: failWith('Could not delete backend')
    });
    const add = useMutation({
        mutationFn: (type: string) => api.post('AddNewBackend', { type_id: type }),
        onSuccess: succeed,
        onError: failWith('Could not add backend')
    });
    const restart = useMutation({
        mutationFn: (backend: string) => api.post('RestartBackends', { backend }),
        onSuccess: succeed,
        onError: failWith('Could not restart')
    });
    const edit = useMutation({
        mutationFn: (input: BackendSaveInput) => api.post('EditBackend', input),
        onMutate: (input) =>
            setSaveErrors(e => {
                const { [input.backend_id]: _dropped, ...rest } = e;
                return rest;
            }),
        onError: (error, input) =>
            setSaveErrors(e => ({
                ...e,
                [input.backend_id]: error instanceof Error ? error.message : 'Failed to save backend.'
            })),
        onSuccess: invalidate
    });

    const list = Object.values(backends.data ?? {}).sort((a, b) => a.id - b.id);
    const typeList = types.data?.list ?? [];
    const typeById = new Map(typeList.map(t => [t.id, t]));
    const advancedCount = typeList.filter(t => !t.is_standard).length;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-2">
                <h1 className="text-sm font-medium text-fg-strong">Backends</h1>
                <span className="text-xs text-fg-soft">{list.length}</span>
                <div className="flex-1" />
                {perms.restart && list.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setPendingRestart('all')}
                        disabled={restart.isPending}
                        className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        <RefreshCw size={12} className={restart.isPending ? 'animate-spin' : ''} aria-hidden />
                        Restart all
                    </button>
                )}
                {perms.addRemove && (
                    <Popover.Root>
                        <Popover.Trigger asChild>
                            <button
                                type="button"
                                className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs"
                                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
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
                                className="z-50 max-h-96 w-80 overflow-y-auto rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                            >
                                {typeList
                                    .filter(type => type.is_standard || showAdvancedTypes)
                                    .map(type => (
                                        <Popover.Close asChild key={type.id}>
                                            <button
                                                type="button"
                                                onClick={() => setPendingAdd(type)}
                                                className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--sw-hover)]"
                                            >
                                                <span className="block text-sm text-fg">
                                                    {type.name}
                                                    {!type.is_standard && (
                                                        <span
                                                            className="ml-1.5 rounded-full px-1.5 text-[10px]"
                                                            style={{
                                                                background: 'var(--sw-danger-surface)',
                                                                color: 'var(--text)'
                                                            }}
                                                        >
                                                            advanced
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="block text-xs text-fg-soft">{type.description}</span>
                                            </button>
                                        </Popover.Close>
                                    ))}
                                {advancedCount > 0 && (
                                    <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-subtle px-2 pt-2 pb-1 text-xs text-fg-soft">
                                        <input
                                            type="checkbox"
                                            checked={showAdvancedTypes}
                                            onChange={e => setShowAdvancedTypes(e.target.checked)}
                                            className="accent-[var(--emphasis)]"
                                        />
                                        Show {advancedCount} advanced types
                                    </label>
                                )}
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                )}
            </div>

            {actionError && (
                <div
                    className="flex shrink-0 items-start gap-2 border-b border-subtle px-4 py-2 text-sm"
                    style={{ background: 'var(--sw-danger-surface)', color: 'var(--text)' }}
                    role="alert"
                >
                    <span className="min-w-0 flex-1">{actionError}</span>
                    <button
                        type="button"
                        onClick={() => setActionError(null)}
                        aria-label="Dismiss error"
                        className="shrink-0 rounded px-1 text-fg-soft hover:text-fg"
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {backends.isPending ? (
                    <p className="text-sm text-fg-soft">Loading backends…</p>
                ) : list.length === 0 ? (
                    <div className="mx-auto max-w-md rounded-lg border border-default bg-surface p-5 text-center">
                        <p className="text-fg">No backends configured.</p>
                        <p className="mt-1 text-sm text-fg-soft">
                            Swarm needs at least one backend to generate images. Add a ComfyUI
                            Self-Starting backend to get going.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {list.map(backend => (
                            <BackendCard
                                key={backend.id}
                                backend={backend}
                                type={typeById.get(backend.type)}
                                perms={perms}
                                logName={
                                    canViewLogs
                                        ? backendLogName(logTypes.data?.types_available ?? [], backend.id)
                                        : null
                                }
                                saving={edit.isPending && edit.variables?.backend_id === backend.id}
                                saveError={saveErrors[backend.id] ?? null}
                                onSave={input => edit.mutate(input)}
                                onToggle={enabled => toggle.mutate({ id: backend.id, enabled })}
                                onRestart={() => setPendingRestart(backend.id)}
                                onDelete={() => setPendingDelete(backend.id)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={pendingAdd !== null}
                title={`Add ${pendingAdd?.name ?? ''} backend?`}
                body={
                    <>
                        {pendingAdd?.description}
                        {pendingAdd && !pendingAdd.is_standard && (
                            <p className="mt-2" style={{ color: 'var(--backend-disabled)' }}>
                                This type is marked advanced-users-only. If you are not sure you need it,
                                you probably want ComfyUI Self-Starting instead.
                            </p>
                        )}
                        <p className="mt-2">It will be created disabled-until-configured and started up.</p>
                    </>
                }
                confirmLabel="Add backend"
                onConfirm={() => {
                    if (pendingAdd) {
                        add.mutate(pendingAdd.id);
                    }
                    setPendingAdd(null);
                }}
                onCancel={() => setPendingAdd(null)}
            />

            <ConfirmDialog
                open={pendingRestart !== null}
                title={pendingRestart === 'all' ? 'Restart all backends?' : `Restart backend #${pendingRestart}?`}
                body={
                    pendingRestart === 'all'
                        ? 'Every backend shuts down and reloads. Generations in progress will be interrupted.'
                        : 'The backend shuts down and reloads. Any generation running on it will be interrupted.'
                }
                confirmLabel="Restart"
                onConfirm={() => {
                    if (pendingRestart !== null) {
                        restart.mutate(String(pendingRestart));
                    }
                    setPendingRestart(null);
                }}
                onCancel={() => setPendingRestart(null)}
            />

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
