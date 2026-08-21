import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BackendCard, type BackendSaveInput } from '@/components/server/BackendCard';
import { backendLogName, isLive, type Backend, type BackendType } from '@/server/backends';
import { useTranslation } from '@/i18n';

export function BackendsPage() {
    const { t, tDynamic } = useTranslation();
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
    const failWith = (whatKey: string) => (error: unknown) =>
        setActionError(
            `${t(whatKey)}: ${error instanceof Error ? error.message : String(error)}`
        );
    const succeed = () => {
        setActionError(null);
        return invalidate();
    };

    // One click, one outcome: a live backend goes off, anything else comes up.
    //
    // The awkward case is a backend that reports enabled while sitting in 'disabled' — where a
    // freshly added, not-yet-configured one lands. Asking for enabled=true there does nothing at
    // all: ToggleBackend answers "No change." whenever IsEnabled already matches
    // (src/WebAPI/BackendAPI.cs:122), and only the enabling branch re-queues the backend for init.
    // Off-and-on is what actually starts it, so send that pair here rather than making the user
    // press the button twice to no visible purpose.
    const toggle = useMutation({
        mutationFn: async (backend: Backend) => {
            if (isLive(backend)) {
                return api.post('ToggleBackend', { backend_id: backend.id, enabled: false });
            }
            if (backend.enabled) {
                await api.post('ToggleBackend', { backend_id: backend.id, enabled: false });
            }
            return api.post('ToggleBackend', { backend_id: backend.id, enabled: true });
        },
        onSuccess: succeed,
        onError: failWith('backends.error.toggle')
    });
    const remove = useMutation({
        mutationFn: (id: number) => api.post('DeleteBackend', { backend_id: id }),
        onSuccess: succeed,
        onError: failWith('backends.error.delete')
    });
    const add = useMutation({
        mutationFn: (type: string) => api.post('AddNewBackend', { type_id: type }),
        onSuccess: succeed,
        onError: failWith('backends.error.add')
    });
    const restart = useMutation({
        mutationFn: (backend: string) => api.post('RestartBackends', { backend }),
        onSuccess: succeed,
        onError: failWith('backends.error.restart')
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
                [input.backend_id]: error instanceof Error ? error.message : t('backends.error.save')
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
                <h1 className="text-sm font-medium text-fg-strong">{t('nav.destination.backends')}</h1>
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
                        {t('backends.restartAll')}
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
                                {t('backends.addBackend')}
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
                                                    {tDynamic(type.name)}
                                                    {!type.is_standard && (
                                                        <span
                                                            className="ml-1.5 rounded-full px-1.5 text-[10px]"
                                                            style={{
                                                                background: 'var(--sw-danger-surface)',
                                                                color: 'var(--text)'
                                                            }}
                                                        >
                                                            {t('backends.advanced')}
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="block text-xs text-fg-soft">
                                                    {tDynamic(type.description)}
                                                </span>
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
                                        {t('backends.showAdvancedTypes', { count: advancedCount })}
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
                        aria-label={t('common.dismissError')}
                        className="shrink-0 rounded px-1 text-fg-soft hover:text-fg"
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {backends.isPending ? (
                    <p className="text-sm text-fg-soft">{t('backends.loading')}</p>
                ) : list.length === 0 ? (
                    <div className="mx-auto max-w-md rounded-lg border border-default bg-surface p-5 text-center">
                        <p className="text-fg">{t('backends.noneConfigured')}</p>
                        <p className="mt-1 text-sm text-fg-soft">{t('backends.noneConfiguredHint')}</p>
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
                                onToggle={() => toggle.mutate(backend)}
                                onRestart={() => setPendingRestart(backend.id)}
                                onDelete={() => setPendingDelete(backend.id)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={pendingAdd !== null}
                title={t('backends.addTitle', { type: tDynamic(pendingAdd?.name ?? '') })}
                body={
                    <>
                        {tDynamic(pendingAdd?.description)}
                        {pendingAdd && !pendingAdd.is_standard && (
                            <p className="mt-2" style={{ color: 'var(--backend-disabled)' }}>
                                {t('backends.addAdvancedWarning')}
                            </p>
                        )}
                        <p className="mt-2">{t('backends.addNote')}</p>
                    </>
                }
                confirmLabel={t('backends.addBackend')}
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
                title={
                    pendingRestart === 'all'
                        ? t('backends.restartAllTitle')
                        : t('backends.restartOneTitle', { id: String(pendingRestart) })
                }
                body={
                    pendingRestart === 'all'
                        ? t('backends.restartAllBody')
                        : t('backends.restartOneBody')
                }
                confirmLabel={t('backends.restart')}
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
                title={t('backends.deleteTitle')}
                body={t('backends.deleteBody', { id: String(pendingDelete) })}
                confirmLabel={t('common.delete')}
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
