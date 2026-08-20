import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { KeyRound, Trash2, UserCog } from 'lucide-react';
import { api } from '@/api/client';
import { useSession } from '@/api/hooks';
import { MIN_PASSWORD_LENGTH, prehashPassword } from '@/api/password';
import { Field } from '@/components/form/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SettingsForm } from '@/components/settings/SettingsForm';
import {
    rolesFromSettings,
    ROLES_SETTING_KEY,
    settingsWithoutRoles,
    type RoleInfo,
    type UserInfo
} from '@/server/users';

const INPUT =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Everything an admin can do to one account.
 *
 * Split into two panes because they are genuinely two jobs: the account itself (roles, password,
 * OAuth, deletion) and the ~60-row settings tree that account carries. The legacy UI stacks both
 * into one scroll and leaves the settings tree ungrouped below the buttons
 * (src/wwwroot/js/genpage/server/servertab.js:160). */
export function UserDetail(props: {
    userId: string;
    roles: Record<string, RoleInfo>;
    /** False when the session lacks configure_roles, so AdminListRoles was never readable. */
    rolesKnown: boolean;
}) {
    const queryClient = useQueryClient();
    const session = useSession();
    const [pane, setPane] = useState<'account' | 'settings'>('account');
    const [pendingDelete, setPendingDelete] = useState(false);
    const [changingPassword, setChangingPassword] = useState(false);

    const isSelf = session.data?.user_id === props.userId;

    const info = useQuery({
        queryKey: ['admin-user', props.userId],
        queryFn: () => api.post<UserInfo>('AdminGetUserInfo', { name: props.userId })
    });

    // Selecting another account should land on the account pane, not wherever the last one was.
    useEffect(() => setPane('account'), [props.userId]);

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['admin-user', props.userId] });
        queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    };

    const saveSettings = useMutation({
        mutationFn: (settings: Record<string, unknown>) =>
            api.post('AdminChangeUserSettings', { name: props.userId, settings }),
        onSuccess: invalidate
    });
    const remove = useMutation({
        mutationFn: () => api.post('AdminDeleteUser', { name: props.userId }),
        onSuccess: invalidate
    });

    if (info.isPending) {
        return <p className="p-4 text-sm text-fg-soft">Loading {props.userId}…</p>;
    }
    if (info.isError || !info.data) {
        return (
            <p className="p-4 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {errorText(info.error)}
            </p>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-2">
                <h2 className="text-sm font-medium text-fg-strong">{props.userId}</h2>
                {isSelf && <span className="text-xs text-fg-soft">(this is you)</span>}
                <div className="flex overflow-hidden rounded border border-default">
                    {(['account', 'settings'] as const).map(id => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setPane(id)}
                            aria-pressed={pane === id}
                            className="px-2.5 py-1 text-xs capitalize transition-colors"
                            style={
                                pane === id
                                    ? { background: 'var(--sw-active)', color: 'var(--text-strong)' }
                                    : { color: 'var(--sw-fg-soft)' }
                            }
                        >
                            {id}
                        </button>
                    ))}
                </div>
                <div className="flex-1" />
                {!isSelf && (
                    <>
                        <button
                            type="button"
                            onClick={() => impersonate(props.userId)}
                            title="Reload this interface as that user"
                            className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                        >
                            <UserCog size={12} aria-hidden />
                            Impersonate
                        </button>
                        <button
                            type="button"
                            onClick={() => setPendingDelete(true)}
                            className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs hover:bg-[var(--sw-hover)]"
                            style={{ color: 'var(--backend-errored)' }}
                        >
                            <Trash2 size={12} aria-hidden />
                            Delete
                        </button>
                    </>
                )}
            </div>

            {pane === 'account' ? (
                <div
                    className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
                    style={{ ['--sw-field-label-width' as string]: '13rem' }}
                >
                    {isSelf && (
                        <p className="mb-3 rounded border border-default bg-surface-sunken px-2 py-1.5 text-xs text-fg-soft">
                            This is your own account. Editing your roles here can lock you out of this
                            screen, and the server refuses to let you delete yourself.
                        </p>
                    )}

                    <RolesPanel
                        userId={props.userId}
                        roles={props.roles}
                        rolesKnown={props.rolesKnown}
                        current={rolesFromSettings(info.data.settings)}
                        maxT2I={info.data.max_t2i}
                        onSaved={invalidate}
                    />

                    <Section title="Password">
                        <Field id="pw-set-by" label="Last set by" density="compact">
                            <span className="text-sm text-fg">
                                {info.data.password_set_by_admin ? 'An admin' : 'The user'}
                            </span>
                        </Field>
                        <p className="mt-1 mb-2 text-xs text-fg-soft">
                            Setting a password here marks it admin-set, so the user is asked to change
                            it the next time they log in.
                        </p>
                        <button
                            type="button"
                            onClick={() => setChangingPassword(true)}
                            className="flex items-center gap-1.5 rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <KeyRound size={12} aria-hidden />
                            Set password
                        </button>
                    </Section>

                    <OAuthPanel
                        userId={props.userId}
                        email={info.data.oauth_email}
                        onSaved={invalidate}
                    />
                </div>
            ) : (
                <div className="min-h-0 flex-1">
                    {/* The role list lives in the settings tree too, but it is edited above — showing
                        it twice would let the two editors disagree. */}
                    <SettingsForm
                        tree={settingsWithoutRoles(info.data.settings)}
                        saving={saveSettings.isPending}
                        onSave={async changes => {
                            await saveSettings.mutateAsync(changes);
                        }}
                    />
                </div>
            )}

            <SetPasswordDialog
                open={changingPassword}
                userId={props.userId}
                onClose={() => setChangingPassword(false)}
                onSaved={invalidate}
            />

            <ConfirmDialog
                open={pendingDelete}
                title="Delete user?"
                body={
                    <>
                        <strong className="text-fg">{props.userId}</strong> and their personal data —
                        settings, presets, history index — are removed. Images already written to disk
                        stay there. This cannot be undone.
                    </>
                }
                confirmLabel="Delete user"
                destructive
                onConfirm={() => {
                    setPendingDelete(false);
                    remove.mutate();
                }}
                onCancel={() => setPendingDelete(false)}
            />

            {remove.isError && (
                <p className="shrink-0 px-4 py-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(remove.error)}
                </p>
            )}
        </div>
    );
}

/** Sends the browser back through session setup as another user.
 *  api/client.ts reads `impersonate` off the query string when it calls GetNewSession. */
function impersonate(userId: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('impersonate', userId);
    url.hash = '';
    window.location.href = url.toString();
}

/** A user's roles are a `List<string>` setting rather than a field of their own, so this saves
 *  through AdminChangeUserSettings. It sends a real JSON array — DataToType accepts one directly
 *  (src/WebAPI/AdminAPI.cs:127), whereas a joined string would be re-split on commas and lose any
 *  role name the display separator had glued together. */
function RolesPanel(props: {
    userId: string;
    roles: Record<string, RoleInfo>;
    rolesKnown: boolean;
    current: string[];
    maxT2I: number;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState<string[]>(props.current);

    useEffect(() => setDraft(props.current), [props.userId, props.current.join(' ')]);

    const save = useMutation({
        mutationFn: () =>
            api.post('AdminChangeUserSettings', {
                name: props.userId,
                settings: { [ROLES_SETTING_KEY]: draft }
            }),
        onSuccess: props.onSaved
    });

    const dirty =
        draft.length !== props.current.length || draft.some(r => !props.current.includes(r));
    const known = Object.keys(props.roles);
    // A role can be deleted while a user still lists it; BuildRoles just skips it. Show it anyway
    // so the stale entry is visible and removable rather than silently dropped on the next save.
    const orphans = draft.filter(id => !(id in props.roles));

    // Without the role list there is no way to tell a valid role from a deleted one, and no set to
    // pick from — so show what the account holds and leave editing to someone who can read it.
    if (!props.rolesKnown) {
        return (
            <Section title="Roles">
                <p className="mb-2 text-xs text-fg-soft">
                    Editing roles needs the <code className="font-mono">configure_roles</code>{' '}
                    permission, which this account doesn't have.
                </p>
                <p className="text-sm text-fg">
                    {props.current.length > 0 ? props.current.join(', ') : 'No roles assigned.'}
                </p>
                <p className="mt-2 text-xs text-fg-soft">
                    Effective simultaneous generation cap:{' '}
                    <span className="text-fg">{props.maxT2I}</span>
                </p>
            </Section>
        );
    }

    return (
        <Section title="Roles">
            <p className="mb-2 text-xs text-fg-soft">
                Permissions come from roles. A user gets the union of every permission across all of
                their roles, and the most permissive limit of each numeric cap.
            </p>
            <ul className="mb-2 rounded border border-default divide-y divide-[var(--light-border)]">
                {known.map(id => {
                    const role = props.roles[id];
                    return (
                        <li key={id} className="flex items-start gap-2 px-2 py-1.5">
                            <input
                                id={`user-role-${id}`}
                                type="checkbox"
                                checked={draft.includes(id)}
                                onChange={e =>
                                    setDraft(d => (e.target.checked ? [...d, id] : d.filter(r => r !== id)))
                                }
                                className="mt-1 shrink-0 accent-[var(--emphasis)]"
                            />
                            <label htmlFor={`user-role-${id}`} className="min-w-0 flex-1 cursor-pointer">
                                <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-fg-strong">
                                    {role.name || id}
                                    <span className="font-mono text-[11px] text-fg-soft">{id}</span>
                                    <span className="text-[11px] text-fg-soft">
                                        {role.permissions.length} permission(s)
                                    </span>
                                </span>
                                {role.description && (
                                    <span className="block whitespace-pre-wrap text-xs text-fg-soft">
                                        {role.description}
                                    </span>
                                )}
                            </label>
                        </li>
                    );
                })}
                {orphans.map(id => (
                    <li key={id} className="flex items-start gap-2 px-2 py-1.5">
                        <input
                            id={`user-role-${id}`}
                            type="checkbox"
                            checked
                            onChange={() => setDraft(d => d.filter(r => r !== id))}
                            className="mt-1 shrink-0 accent-[var(--emphasis)]"
                        />
                        <label htmlFor={`user-role-${id}`} className="min-w-0 flex-1 cursor-pointer">
                            <span className="font-mono text-sm text-fg-strong">{id}</span>
                            <span
                                className="block text-xs"
                                style={{ color: 'var(--status-bar-warn-color-start-end)' }}
                            >
                                This role no longer exists, so it grants nothing.
                            </span>
                        </label>
                    </li>
                ))}
            </ul>

            <p className="text-xs text-fg-soft">
                Effective simultaneous generation cap: <span className="text-fg">{props.maxT2I}</span>{' '}
                (after combining roles with the backends currently available)
            </p>

            {save.isError && (
                <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(save.error)}
                </p>
            )}

            {dirty && (
                <div className="mt-2 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setDraft(props.current)}
                        className="rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)]"
                    >
                        Discard
                    </button>
                    <button
                        type="button"
                        onClick={() => save.mutate()}
                        disabled={save.isPending}
                        className="rounded px-2.5 py-1 text-xs disabled:opacity-50"
                        style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                    >
                        {save.isPending ? 'Saving…' : 'Save roles'}
                    </button>
                </div>
            )}
        </Section>
    );
}

function OAuthPanel(props: { userId: string; email: string; onSaved: () => void }) {
    const [email, setEmail] = useState(props.email);

    useEffect(() => setEmail(props.email), [props.userId, props.email]);

    const save = useMutation({
        mutationFn: () => api.post('AdminSetUserOAuthEmail', { name: props.userId, email }),
        onSuccess: props.onSaved
    });

    return (
        <Section title="OAuth">
            <Field
                id="oauth-email"
                label="Linked email"
                description="The email address an OAuth provider must return for it to sign in as this user. Leave empty to unlink."
                density="compact"
            >
                <input
                    id="oauth-email"
                    type="email"
                    value={email}
                    placeholder="(not linked)"
                    onChange={e => setEmail(e.target.value)}
                    className={`${INPUT} w-full`}
                />
            </Field>
            {save.isError && (
                <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {errorText(save.error)}
                </p>
            )}
            {email !== props.email && (
                <div className="mt-2 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setEmail(props.email)}
                        className="rounded border border-default px-2.5 py-1 text-xs text-fg hover:bg-[var(--sw-hover)]"
                    >
                        Discard
                    </button>
                    <button
                        type="button"
                        onClick={() => save.mutate()}
                        disabled={save.isPending}
                        className="rounded px-2.5 py-1 text-xs disabled:opacity-50"
                        style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                    >
                        {save.isPending ? 'Saving…' : 'Save email'}
                    </button>
                </div>
            )}
        </Section>
    );
}

function SetPasswordDialog(props: {
    open: boolean;
    userId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    useEffect(() => {
        if (props.open) {
            setPassword('');
            setConfirm('');
        }
    }, [props.open]);

    const save = useMutation({
        mutationFn: async () =>
            api.post('AdminSetUserPassword', {
                name: props.userId,
                // Prehashed against the *target* user's id — the server salts with the account name,
                // so hashing against the admin's id would produce a password nobody can log in with.
                password: await prehashPassword(props.userId, password)
            }),
        onSuccess: () => {
            props.onSaved();
            props.onClose();
        }
    });

    const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
    const mismatch = confirm.length > 0 && password !== confirm;
    const canSubmit = password.length >= MIN_PASSWORD_LENGTH && password === confirm && !save.isPending;

    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[min(28rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-1 text-base font-medium text-fg-strong">
                        Set password
                    </Dialog.Title>
                    <Dialog.Description className="mb-3 text-sm text-fg-soft">
                        Replaces the password for <span className="text-fg">{props.userId}</span>. They
                        are asked to change it the next time they log in.
                    </Dialog.Description>

                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="admin-new-pw">
                        New password
                    </label>
                    <input
                        id="admin-new-pw"
                        type="password"
                        autoComplete="new-password"
                        autoFocus
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className={`${INPUT} mb-2 w-full`}
                    />
                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="admin-confirm-pw">
                        Confirm password
                    </label>
                    <input
                        id="admin-confirm-pw"
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && canSubmit) {
                                save.mutate();
                            }
                        }}
                        className={`${INPUT} w-full`}
                    />

                    {tooShort && (
                        <p className="mt-1.5 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            Must be at least {MIN_PASSWORD_LENGTH} characters.
                        </p>
                    )}
                    {mismatch && (
                        <p className="mt-1.5 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            The passwords don't match.
                        </p>
                    )}
                    {save.isError && (
                        <p className="mt-1.5 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {errorText(save.error)}
                        </p>
                    )}

                    <div className="mt-4 flex justify-end gap-2">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                Cancel
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            disabled={!canSubmit}
                            onClick={() => save.mutate()}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {save.isPending ? 'Setting…' : 'Set password'}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Section(props: { title: string; children: React.ReactNode }) {
    return (
        <section className="mb-3 rounded-lg border border-default bg-surface p-3">
            <h3 className="mb-2 text-sm font-medium text-fg-strong">{props.title}</h3>
            {props.children}
        </section>
    );
}
