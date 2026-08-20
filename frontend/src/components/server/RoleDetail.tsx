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
        onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save role.')
    });
    const remove = useMutation({
        mutationFn: () => api.post('AdminDeleteRole', { name: props.roleId }),
        onSuccess: () => {
            invalidate();
            props.onDeleted();
        },
        onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to delete role.')
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
                        Delete role
                    </button>
                )}
            </div>

            <div
                className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
                style={{ ['--sw-field-label-width' as string]: '13rem' }}
            >
                {props.role.is_auto_generated && (
                    <p className="mb-3 rounded border border-default bg-surface-sunken px-2 py-1.5 text-xs text-fg-soft">
                        Built-in role. It cannot be deleted, and newly registered permissions are
                        added to it automatically based on their default audience.
                    </p>
                )}

                <Field
                    id="role-description"
                    label="Description"
                    description={'Human-readable notes for whoever picks roles later.\nSay when a user should get this role and roughly what it unlocks.'}
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
                    label="Max OutPath depth"
                    description={'How many directories deep a custom OutPath may go. Default 5.\nA guard against filesystem corruption; higher values are usually fine.\nA user gets the highest value across all of their roles.'}
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
                    label="Max simultaneous generations"
                    description={'How many images a user may have generating at once. Default 32.\nAlso capped by the number of available backends.\nThis stops one user taking every backend at once — lower it if you have few backends and many users.\nA user gets the highest value across all of their roles.'}
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
                    label="Allow unsafe OutPaths"
                    description={"Whether '.' may appear in an OutPath. Enabling this lets users escape their output folder and cause filesystem problems."}
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
                            {draft.allow_unsafe_outpaths ? 'Allowed' : 'Blocked'}
                        </span>
                    </label>
                </Field>

                <Field
                    id="role-whitelist"
                    label="Model whitelist"
                    description={"Allowed models, as a comma-separated list of path prefixes, eg 'sdxl/, flux/'.\nEmpty means no whitelist is applied.\nWhitelists from a user's roles add together."}
                    density="compact"
                >
                    <input
                        id="role-whitelist"
                        type="text"
                        value={draft.model_whitelist}
                        disabled={props.readOnly}
                        placeholder="eg sdxl/, flux/"
                        onChange={e => set('model_whitelist', e.target.value)}
                        className={`${INPUT} w-full`}
                    />
                </Field>

                <Field
                    id="role-blacklist"
                    label="Model blacklist"
                    description={"Forbidden models, as a comma-separated list of path prefixes.\nEmpty means no blacklist is applied.\nThe blacklist wins over the whitelist.\nBlacklists from a user's roles add together."}
                    density="compact"
                >
                    <input
                        id="role-blacklist"
                        type="text"
                        value={draft.model_blacklist}
                        disabled={props.readOnly}
                        placeholder="eg experimental/"
                        onChange={e => set('model_blacklist', e.target.value)}
                        className={`${INPUT} w-full`}
                    />
                </Field>

                <h3 className="mb-2 mt-4 text-sm font-medium text-fg-strong">Permissions</h3>
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
                                {edits} unsaved {edits === 1 ? 'change' : 'changes'}
                            </span>
                            <div className="flex-1" />
                            <button
                                type="button"
                                onClick={() => setDraft(draftFromRole(props.role))}
                                disabled={save.isPending}
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                onClick={() => save.mutate()}
                                disabled={save.isPending}
                                className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                            >
                                {save.isPending ? 'Saving…' : 'Save changes'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={pendingDelete}
                title="Delete role?"
                body={
                    <>
                        <strong className="text-fg">{props.role.name || props.roleId}</strong> will be
                        removed. Users holding it lose whatever access only it granted. This cannot be
                        undone.
                    </>
                }
                confirmLabel="Delete role"
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
