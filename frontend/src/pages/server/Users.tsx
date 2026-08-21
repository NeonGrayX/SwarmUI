import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Search, Shield, User as UserIcon, X } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { MIN_PASSWORD_LENGTH, prehashPassword } from '@/api/password';
import { PermissionCatalog } from '@/components/server/PermissionCatalog';
import { RoleDetail } from '@/components/server/RoleDetail';
import { UserDetail } from '@/components/server/UserDetail';
import type { PermissionInfo, RoleInfo } from '@/server/users';
import { useTranslation } from '@/i18n';

const INPUT =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

type Tab = 'users' | 'roles' | 'permissions';

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Accounts, roles and permissions.
 *
 * Master-detail rather than the legacy UI's shared left rail, which stacks roles and users into one
 * column and paints the right pane with hand-built HTML strings
 * (src/wwwroot/js/genpage/server/servertab.js:77). The two lists have different actions and
 * different permissions behind them, so they get their own tabs.
 *
 * Two permissions are in play and neither implies the other: manage_users covers the accounts,
 * configure_roles covers roles and the permission catalog. */
export function UsersPage() {
    const { t, tDynamic } = useTranslation();
    const queryClient = useQueryClient();
    const canManageUsers = usePermission('manage_users');
    const canConfigureRoles = usePermission('configure_roles');

    const [tab, setTab] = useState<Tab>('users');
    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<string | null>(null);
    const [addingUser, setAddingUser] = useState(false);
    const [addingRole, setAddingRole] = useState(false);

    const users = useQuery({
        queryKey: ['admin-users'],
        queryFn: () => api.post<{ users: string[] }>('AdminListUsers'),
        enabled: canManageUsers
    });
    // AdminListRoles and AdminListPermissions are both gated on ConfigureRoles
    // (src/WebAPI/AdminAPI.cs:50), which manage_users does not imply — so an admin who can only
    // manage accounts never gets a role list, and the account screens fall back accordingly.
    const roles = useQuery({
        queryKey: ['admin-roles'],
        queryFn: () => api.post<{ roles: Record<string, RoleInfo> }>('AdminListRoles'),
        enabled: canConfigureRoles
    });
    const permissions = useQuery({
        queryKey: ['admin-permissions'],
        queryFn: () =>
            api.post<{ permissions: Record<string, PermissionInfo>; ordered: string[] }>(
                'AdminListPermissions'
            ),
        // The catalog is fixed for the life of the server process.
        staleTime: Infinity,
        enabled: canConfigureRoles
    });

    const roleMap = useMemo(() => roles.data?.roles ?? {}, [roles.data]);
    const query = search.trim().toLowerCase();

    const userList = useMemo(
        () => (users.data?.users ?? []).filter(name => name.toLowerCase().includes(query)),
        [users.data, query]
    );
    const roleList = useMemo(
        () =>
            Object.entries(roleMap).filter(([id, role]) =>
                `${id} ${role.name} ${tDynamic(role.description)}`.toLowerCase().includes(query)
            ),
        [roleMap, query, tDynamic]
    );

    // A selection can disappear underneath us — the account was deleted, or the role was.
    useEffect(() => {
        if (selectedUser && users.data && !users.data.users.includes(selectedUser)) {
            setSelectedUser(null);
        }
    }, [users.data, selectedUser]);
    useEffect(() => {
        if (selectedRole && roles.data && !(selectedRole in roles.data.roles)) {
            setSelectedRole(null);
        }
    }, [roles.data, selectedRole]);

    const tabs: { id: Tab; label: string; visible: boolean }[] = [
        { id: 'users', label: t('users.tab.users'), visible: canManageUsers },
        { id: 'roles', label: t('users.tab.roles'), visible: canConfigureRoles },
        { id: 'permissions', label: t('users.tab.permissions'), visible: canConfigureRoles }
    ];
    const visibleTabs = tabs.filter(t => t.visible);
    // Permissions read false until the session resolves, so the stored tab can briefly name one the
    // user cannot see. Render whichever tab is actually available rather than an empty pane.
    const activeTab = visibleTabs.some(t => t.id === tab) ? tab : visibleTabs[0]?.id;
    const showList = activeTab !== 'permissions';

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-2">
                <div className="flex overflow-hidden rounded border border-default">
                    {visibleTabs.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => setTab(entry.id)}
                            aria-pressed={activeTab === entry.id}
                            className="px-3 py-1 text-xs transition-colors"
                            style={
                                activeTab === entry.id
                                    ? { background: 'var(--sw-active)', color: 'var(--text-strong)' }
                                    : { color: 'var(--sw-fg-soft)' }
                            }
                        >
                            {entry.label}
                            {entry.id === 'users' && users.data ? ` (${users.data.users.length})` : ''}
                            {entry.id === 'roles' && roles.data
                                ? ` (${Object.keys(roles.data.roles).length})`
                                : ''}
                        </button>
                    ))}
                </div>

                {showList && (
                    <div className="relative min-w-40 max-w-xs flex-1">
                        <Search
                            size={14}
                            aria-hidden
                            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                        />
                        <input
                            type="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={
                                activeTab === 'users'
                                    ? t('users.searchUsersPlaceholder')
                                    : t('users.searchRolesPlaceholder')
                            }
                            aria-label={
                                activeTab === 'users' ? t('users.searchUsers') : t('users.searchRoles')
                            }
                            className={`${INPUT} w-full py-1 pl-7 pr-6`}
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                aria-label={t('common.clearSearch')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                            >
                                <X size={12} aria-hidden />
                            </button>
                        )}
                    </div>
                )}

                <div className="flex-1" />

                {activeTab === 'users' && canManageUsers && (
                    <button
                        type="button"
                        onClick={() => setAddingUser(true)}
                        className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        <Plus size={12} aria-hidden />
                        {t('users.addUser')}
                    </button>
                )}
                {activeTab === 'roles' && canConfigureRoles && (
                    <button
                        type="button"
                        onClick={() => setAddingRole(true)}
                        className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        <Plus size={12} aria-hidden />
                        {t('users.addRole')}
                    </button>
                )}
            </div>

            {activeTab === 'permissions' ? (
                permissions.isPending ? (
                    <p className="p-4 text-sm text-fg-soft">{t('users.loadingPermissions')}</p>
                ) : permissions.isError || !permissions.data ? (
                    <p className="p-4 text-sm" style={{ color: 'var(--backend-errored)' }}>
                        {errorText(permissions.error)}
                    </p>
                ) : (
                    <PermissionCatalog
                        ordered={permissions.data.ordered}
                        info={permissions.data.permissions}
                        roles={roleMap}
                    />
                )
            ) : (
                <div className="flex min-h-0 flex-1">
                    <nav
                        aria-label={activeTab === 'users' ? t('users.accountsLabel') : t('users.tab.roles')}
                        className="w-60 shrink-0 overflow-y-auto border-r border-subtle p-2"
                    >
                        {activeTab === 'users' ? (
                            users.isPending ? (
                                <p className="p-2 text-sm text-fg-soft">{t('common.loading')}</p>
                            ) : users.isError ? (
                                <p className="p-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                                    {errorText(users.error)}
                                </p>
                            ) : userList.length === 0 ? (
                                <p className="p-2 text-sm text-fg-soft">
                                    {query ? t('users.noMatchingUsers') : t('users.noAccounts')}
                                </p>
                            ) : (
                                userList.map(name => (
                                    <ListButton
                                        key={name}
                                        icon={<UserIcon size={13} aria-hidden />}
                                        label={name}
                                        active={selectedUser === name}
                                        onClick={() => setSelectedUser(name)}
                                    />
                                ))
                            )
                        ) : roles.isPending ? (
                            <p className="p-2 text-sm text-fg-soft">{t('common.loading')}</p>
                        ) : roles.isError ? (
                            <p className="p-2 text-sm" style={{ color: 'var(--backend-errored)' }}>
                                {errorText(roles.error)}
                            </p>
                        ) : roleList.length === 0 ? (
                            <p className="p-2 text-sm text-fg-soft">
                                {query ? t('users.noMatchingRoles') : t('users.noRoles')}
                            </p>
                        ) : (
                            roleList.map(([id, role]) => (
                                <ListButton
                                    key={id}
                                    icon={<Shield size={13} aria-hidden />}
                                    label={role.name || id}
                                    sublabel={t('users.permissionCount', {
                                        count: role.permissions.length
                                    })}
                                    title={tDynamic(role.description)}
                                    active={selectedRole === id}
                                    onClick={() => setSelectedRole(id)}
                                />
                            ))
                        )}
                    </nav>

                    <div className="min-w-0 flex-1">
                        {activeTab === 'users' ? (
                            selectedUser ? (
                                <UserDetail
                                    key={selectedUser}
                                    userId={selectedUser}
                                    roles={roleMap}
                                    rolesKnown={canConfigureRoles}
                                />
                            ) : (
                                <Empty text={t('users.selectAccount')} />
                            )
                        ) : selectedRole && roleMap[selectedRole] ? (
                            permissions.isPending || !permissions.data ? (
                                <p className="p-4 text-sm text-fg-soft">{t('users.loadingPermissions')}</p>
                            ) : (
                                <RoleDetail
                                    key={selectedRole}
                                    roleId={selectedRole}
                                    role={roleMap[selectedRole]}
                                    permissionsOrdered={permissions.data.ordered}
                                    permissionsInfo={permissions.data.permissions}
                                    onDeleted={() => setSelectedRole(null)}
                                />
                            )
                        ) : (
                            <Empty text={t('users.selectRole')} />
                        )}
                    </div>
                </div>
            )}

            <AddUserDialog
                open={addingUser}
                roles={roleMap}
                rolesKnown={canConfigureRoles}
                onClose={() => setAddingUser(false)}
                onAdded={name => {
                    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
                    setSelectedUser(name);
                }}
            />
            <AddRoleDialog
                open={addingRole}
                onClose={() => setAddingRole(false)}
                onAdded={() => queryClient.invalidateQueries({ queryKey: ['admin-roles'] })}
            />
        </div>
    );
}

function ListButton(props: {
    icon: React.ReactNode;
    label: string;
    sublabel?: string;
    title?: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            title={props.title}
            aria-current={props.active ? 'true' : undefined}
            className={[
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                props.active
                    ? 'bg-[var(--sw-active)] text-fg-strong'
                    : 'text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
            ].join(' ')}
        >
            <span className="shrink-0">{props.icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{props.label}</span>
                {props.sublabel && (
                    <span className="block truncate text-[11px] opacity-70">{props.sublabel}</span>
                )}
            </span>
        </button>
    );
}

function Empty(props: { text: string }) {
    return (
        <div className="flex h-full items-center justify-center p-8">
            <p className="text-sm text-fg-soft">{props.text}</p>
        </div>
    );
}

/** The server lowercases the name and strips anything outside its username pattern before using
 *  it (SessionHandler.UsernameValidator), so preview the id the account will actually get. */
function cleanName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** What the legacy add-user form offers when it cannot read the role list
 *  (src/wwwroot/js/genpage/server/servertab.js:94). */
const FALLBACK_ROLES: [string, string][] = [
    ['user', 'User'],
    ['guest', 'Guest']
];

function AddUserDialog(props: {
    open: boolean;
    roles: Record<string, RoleInfo>;
    rolesKnown: boolean;
    onClose: () => void;
    onAdded: (name: string) => void;
}) {
    const { t, tDynamic } = useTranslation();
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('user');

    const options: [string, string][] = props.rolesKnown
        ? Object.entries(props.roles).map(([id, entry]) => [id, entry.name || id])
        : FALLBACK_ROLES;
    const activeRole = options.some(([id]) => id === role) ? role : (options[0]?.[0] ?? 'user');

    useEffect(() => {
        if (props.open) {
            setName('');
            setPassword('');
            setRole('user');
        }
    }, [props.open]);

    const cleaned = cleanName(name);

    const add = useMutation({
        mutationFn: async () =>
            api.post('AdminAddUser', {
                name: cleaned,
                password: await prehashPassword(cleaned, password),
                role: activeRole
            }),
        onSuccess: () => {
            props.onAdded(cleaned);
            props.onClose();
        }
    });

    const canSubmit = cleaned.length >= 3 && password.length >= MIN_PASSWORD_LENGTH && !add.isPending;

    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[min(28rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-1 text-base font-medium text-fg-strong">
                        {t('users.addUser')}
                    </Dialog.Title>
                    <Dialog.Description className="mb-3 text-sm text-fg-soft">
                        {t('users.addUserHint')}
                    </Dialog.Description>

                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="new-user-name">
                        {t('users.username')}
                    </label>
                    <input
                        id="new-user-name"
                        type="text"
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder={t('users.namePlaceholder')}
                        className={`${INPUT} w-full font-mono`}
                    />
                    {cleaned !== name.toLowerCase() && cleaned.length > 0 && (
                        <p className="mt-1 text-xs text-fg-soft">
                            {t('users.willBeCreatedAs')}{' '}
                            <span className="font-mono text-fg">{cleaned}</span>.
                        </p>
                    )}
                    {name.length > 0 && cleaned.length < 3 && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {t('users.needsUsableCharacters')}
                        </p>
                    )}

                    <label className="mb-1 mt-2 block text-xs text-fg-soft" htmlFor="new-user-pw">
                        {t('users.password')}
                    </label>
                    <input
                        id="new-user-pw"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className={`${INPUT} w-full`}
                    />
                    {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {t('account.passwordTooShort', { count: MIN_PASSWORD_LENGTH })}
                        </p>
                    )}

                    <label className="mb-1 mt-2 block text-xs text-fg-soft" htmlFor="new-user-role">
                        {t('users.initialRole')}
                    </label>
                    <select
                        id="new-user-role"
                        value={activeRole}
                        onChange={e => setRole(e.target.value)}
                        className={`${INPUT} w-full`}
                    >
                        {options.map(([id, label]) => (
                            <option key={id} value={id} title={tDynamic(props.roles[id]?.description)}>
                                {label}
                            </option>
                        ))}
                    </select>
                    {!props.rolesKnown && (
                        <p className="mt-1 text-xs text-fg-soft">{t('users.fallbackRolesNote')}</p>
                    )}

                    {add.isError && (
                        <p className="mt-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {errorText(add.error)}
                        </p>
                    )}

                    <div className="mt-4 flex justify-end gap-2">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('common.cancel')}
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            disabled={!canSubmit}
                            onClick={() => add.mutate()}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {add.isPending ? t('common.creating') : t('users.createUser')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function AddRoleDialog(props: { open: boolean; onClose: () => void; onAdded: () => void }) {
    const { t } = useTranslation();
    const [name, setName] = useState('');

    useEffect(() => {
        if (props.open) {
            setName('');
        }
    }, [props.open]);

    const cleaned = cleanName(name);

    const add = useMutation({
        // AdminAddRole keys the role by the cleaned name but stores the display name as typed.
        mutationFn: () => api.post('AdminAddRole', { name }),
        onSuccess: () => {
            props.onAdded();
            props.onClose();
        }
    });

    const canSubmit = cleaned.length >= 3 && !add.isPending;

    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[min(28rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-1 text-base font-medium text-fg-strong">
                        {t('users.addRole')}
                    </Dialog.Title>
                    <Dialog.Description className="mb-3 text-sm text-fg-soft">
                        {t('users.addRoleHint')}
                    </Dialog.Description>

                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="new-role-name">
                        {t('users.roleName')}
                    </label>
                    <input
                        id="new-role-name"
                        type="text"
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && canSubmit) {
                                add.mutate();
                            }
                        }}
                        placeholder={t('users.namePlaceholder')}
                        className={`${INPUT} w-full`}
                    />
                    {cleaned.length > 0 && (
                        <p className="mt-1 text-xs text-fg-soft">
                            {t('users.lookedUpAs')} <span className="font-mono text-fg">{cleaned}</span>.
                        </p>
                    )}
                    {name.length > 0 && cleaned.length < 3 && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {t('users.needsUsableCharacters')}
                        </p>
                    )}

                    {add.isError && (
                        <p className="mt-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {errorText(add.error)}
                        </p>
                    )}

                    <div className="mt-4 flex justify-end gap-2">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('common.cancel')}
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            disabled={!canSubmit}
                            onClick={() => add.mutate()}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {add.isPending ? t('common.creating') : t('users.createRole')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
