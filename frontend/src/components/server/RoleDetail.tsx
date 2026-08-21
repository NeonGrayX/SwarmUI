import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { Field } from '@/components/form/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PermissionPicker } from '@/components/server/PermissionPicker';
import {
    countRoleEdits,
    draftFromRole,
    roleEditBody,
    type PermissionInfo,
    type RoleDraft,
    type RoleInfo
} from '@/server/users';
import { useTranslation } from '@/i18n';

const INPUT =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

/** Editor for one role: its limits, then its permission grid.
 *
 * Everything edits into a local draft and saves in one shot, because AdminEditRole takes the whole
 * role on every call — a partial body would silently blank the fields it left out. */
export function RoleDetail(props: {
    roleId: string;
    role: RoleInfo;
    permissionsOrdered: string[];
    permissionsInfo: Record<string, PermissionInfo>;
    readOnly?: boolean;
    onDeleted: () => void;
}) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState<RoleDraft>(() => draftFromRole(props.role));
    const [error, setError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState(false);

    // Selecting a different role, or reloading after a save, resets the form to the server's copy.
    useEffect(() => {
        setDraft(draftFromRole(props.role));
        setError(null);
    }, [props.roleId, props.role]);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-roles'] });

    const save = useMutation({
        mutationFn: () => api.post('AdminEditRole', roleEditBody(props.roleId, draft)),
        onSuccess: () => {
            setError(null);
            invalidate();
        },
        onError: (e: unknown) => setError(e instanceof Error ? e.message : t('roleDetail.saveFailed'))
    });
    const remove = useMutation({
        mutationFn: () => api.post('AdminDeleteRole', { name: props.roleId }),
        onSuccess: () => {
            invalidate();
            props.onDeleted();
        },
        onError: (e: unknown) => setError(e instanceof Error ? e.message : t('roleDetail.deleteFailed'))
    });

    const edits = countRoleEdits(props.role, draft);
    const set = <K extends keyof RoleDraft>(key: K, value: RoleDraft[K]) =>
        setDraft(d => ({ ...d, [key]: value }));

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-2">
                <h2 className="text-sm font-medium text-fg-strong">{props.role.name || props.roleId}</h2>
                <span className="font-mono text-xs text-fg-soft">{props.roleId}</span>
                <div className="flex-1" />
                {!props.readOnly && !props.role.is_auto_generated && (
                    <button
                        type="button"
                        onClick={() => setPendingDelete(true)}
                        className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs hover:bg-[var(--sw-hover)]"
                        style={{ color: 'var(--backend-errored)' }}
                    >
                        <Trash2 size={12} aria-hidden />
                        {t('roleDetail.deleteRole')}
                    </button>
                )}
            </div>

            <div
                className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
                style={{ ['--sw-field-label-width' as string]: '13rem' }}
            >
                {props.role.is_auto_generated && (
                    <p className="mb-3 rounded border border-default bg-surface-sunken px-2 py-1.5 text-xs text-fg-soft">
                        {t('roleDetail.builtIn')}
                    </p>
                )}

                <Field
                    id="role-description"
                    label={t('roleDetail.description')}
                    description={t('roleDetail.descriptionHelp')}
                    density="compact"
                >
                    <textarea
                        id="role-description"
                        rows={2}
                        value={draft.description}
                        disabled={props.readOnly}
                        onChange={e => set('description', e.target.value)}
                        className={`${INPUT} w-full resize-y`}
                    />
                </Field>

                <Field
                    id="role-outpath-depth"
                    label={t('roleDetail.maxOutpathDepth')}
                    description={t('roleDetail.maxOutpathDepthHelp')}
                    density="compact"
                >
                    <input
                        id="role-outpath-depth"
                        type="number"
                        min={1}
                        max={100}
                        value={draft.max_outpath_depth}
                        disabled={props.readOnly}
                        onChange={e => set('max_outpath_depth', parseInt(e.target.value, 10) || 0)}
                        className={`${INPUT} w-32`}
                    />
                </Field>

                <Field
                    id="role-max-t2i"
                    label={t('roleDetail.maxSimultaneous')}
                    description={t('roleDetail.maxSimultaneousHelp')}
                    density="compact"
                >
                    <input
                        id="role-max-t2i"
                        type="number"
                        min={1}
                        max={10000}
                        value={draft.max_t2i_simultaneous}
                        disabled={props.readOnly}
                        onChange={e => set('max_t2i_simultaneous', parseInt(e.target.value, 10) || 0)}
                        className={`${INPUT} w-32`}
                    />
                </Field>

                <Field
                    id="role-unsafe-outpaths"
                    label={t('roleDetail.allowUnsafeOutpaths')}
                    description={t('roleDetail.allowUnsafeOutpathsHelp')}
                    density="compact"
                >
                    <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                            id="role-unsafe-outpaths"
                            type="checkbox"
                            checked={draft.allow_unsafe_outpaths}
                            disabled={props.readOnly}
                            onChange={e => set('allow_unsafe_outpaths', e.target.checked)}
                            className="accent-[var(--emphasis)]"
                        />
                        <span className="text-sm text-fg-soft">
                            {draft.allow_unsafe_outpaths ? t('roleDetail.allowed') : t('roleDetail.blocked')}
                        </span>
                    </label>
                </Field>

                <Field
                    id="role-whitelist"
                    label={t('roleDetail.modelWhitelist')}
                    description={t('roleDetail.modelWhitelistHelp')}
                    density="compact"
                >
                    <input
                        id="role-whitelist"
                        type="text"
                        value={draft.model_whitelist}
                        disabled={props.readOnly}
                        placeholder={t('roleDetail.whitelistPlaceholder')}
                        onChange={e => set('model_whitelist', e.target.value)}
                        className={`${INPUT} w-full`}
                    />
                </Field>

                <Field
                    id="role-blacklist"
                    label={t('roleDetail.modelBlacklist')}
                    description={t('roleDetail.modelBlacklistHelp')}
                    density="compact"
                >
                    <input
                        id="role-blacklist"
                        type="text"
                        value={draft.model_blacklist}
                        disabled={props.readOnly}
                        placeholder={t('roleDetail.blacklistPlaceholder')}
                        onChange={e => set('model_blacklist', e.target.value)}
                        className={`${INPUT} w-full`}
                    />
                </Field>

                <h3 className="mb-2 mt-4 text-sm font-medium text-fg-strong">
                    {t('users.tab.permissions')}
                </h3>
                <PermissionPicker
                    ordered={props.permissionsOrdered}
                    info={props.permissionsInfo}
                    selected={draft.permissions}
                    disabled={props.readOnly}
                    onToggle={(id, on) =>
                        setDraft(d => ({
                            ...d,
                            permissions: on
                                ? [...d.permissions, id]
                                : d.permissions.filter(p => p !== id)
                        }))
                    }
                />
            </div>

            {(edits > 0 || error) && !props.readOnly && (
                <div className="shrink-0 border-t border-subtle bg-surface-raised px-4 py-2">
                    {error && (
                        <p className="mb-1.5 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {error}
                        </p>
                    )}
                    {edits > 0 && (
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-fg">
                                {t('settings.unsavedCount', { count: edits })}
                            </span>
                            <div className="flex-1" />
                            <button
                                type="button"
                                onClick={() => setDraft(draftFromRole(props.role))}
                                disabled={save.isPending}
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('common.discard')}
                            </button>
                            <button
                                type="button"
                                onClick={() => save.mutate()}
                                disabled={save.isPending}
                                className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                            >
                                {save.isPending ? t('common.saving') : t('settings.saveChanges')}
                            </button>
                        </div>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={pendingDelete}
                title={t('roleDetail.deleteTitle')}
                body={
                    <>
                        <strong className="text-fg">{props.role.name || props.roleId}</strong>{' '}
                        {t('roleDetail.deleteBody')}
                    </>
                }
                confirmLabel={t('roleDetail.deleteRole')}
                destructive
                onConfirm={() => {
                    setPendingDelete(false);
                    remove.mutate();
                }}
                onCancel={() => setPendingDelete(false)}
            />
        </div>
    );
}
