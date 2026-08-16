import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, User as UserIcon } from 'lucide-react';
import { api } from '@/api/client';

interface RoleInfo {
    name: string;
    description: string;
    max_outpath_depth?: number;
    max_t2i_simultaneous?: number;
    allow_unsafe_outpaths?: boolean;
    model_whitelist?: string[];
    model_blacklist?: string[];
    permissions?: string[];
}

interface PermissionInfo {
    name: string;
    description: string;
    group?: { name?: string } | string;
    default?: string;
}

export function UsersPage() {
    const [tab, setTab] = useState<'users' | 'roles' | 'permissions'>('users');

    const users = useQuery({
        queryKey: ['admin-users'],
        queryFn: () => api.post<{ users: string[] }>('AdminListUsers')
    });
    const roles = useQuery({
        queryKey: ['admin-roles'],
        queryFn: () => api.post<Record<string, RoleInfo>>('AdminListRoles'),
        enabled: tab === 'roles'
    });
    const permissions = useQuery({
        queryKey: ['admin-permissions'],
        queryFn: () => api.post<Record<string, PermissionInfo>>('AdminListPermissions'),
        enabled: tab === 'permissions'
    });

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-2">
                <div className="flex overflow-hidden rounded border border-default">
                    {(['users', 'roles', 'permissions'] as const).map(id => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            aria-pressed={tab === id}
                            className="px-3 py-1 text-xs capitalize transition-colors"
                            style={
                                tab === id
                                    ? { background: 'var(--sw-active)', color: 'var(--text-strong)' }
                                    : { color: 'var(--text-soft)' }
                            }
                        >
                            {id}
                        </button>
                    ))}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {tab === 'users' && (
                    <List
                        pending={users.isPending}
                        empty="No user accounts."
                        items={(users.data?.users ?? []).map(name => ({
                            key: name,
                            icon: <UserIcon size={14} aria-hidden />,
                            title: name,
                            subtitle: ''
                        }))}
                    />
                )}
                {tab === 'roles' && (
                    <List
                        pending={roles.isPending}
                        empty="No roles defined."
                        items={Object.entries(roles.data ?? {}).map(([id, role]) => ({
                            key: id,
                            icon: <Shield size={14} aria-hidden />,
                            title: role.name || id,
                            subtitle: `${role.description || 'No description.'}${
                                role.permissions ? ` · ${role.permissions.length} permissions` : ''
                            }`
                        }))}
                    />
                )}
                {tab === 'permissions' && (
                    <List
                        pending={permissions.isPending}
                        empty="No permissions registered."
                        items={Object.entries(permissions.data ?? {}).map(([id, perm]) => ({
                            key: id,
                            icon: <Shield size={14} aria-hidden />,
                            title: perm.name || id,
                            subtitle: perm.description || '',
                            mono: id
                        }))}
                    />
                )}
            </div>

            <p className="shrink-0 border-t border-subtle px-4 py-2 text-xs text-fg-soft">
                Creating and editing users and roles is read-only here for now; use the existing
                interface at <a href="/Text2Image" className="underline">/Text2Image</a> to make changes.
            </p>
        </div>
    );
}

function List(props: {
    pending: boolean;
    empty: string;
    items: { key: string; icon: React.ReactNode; title: string; subtitle: string; mono?: string }[];
}) {
    if (props.pending) {
        return <p className="text-sm text-fg-soft">Loading…</p>;
    }
    if (props.items.length === 0) {
        return <p className="text-sm text-fg-soft">{props.empty}</p>;
    }
    return (
        <ul className="space-y-1.5">
            {props.items.map(item => (
                <li
                    key={item.key}
                    className="flex items-start gap-3 rounded-lg border border-default bg-surface p-3"
                >
                    <span className="mt-0.5 shrink-0 text-fg-soft">{item.icon}</span>
                    <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-2 text-sm text-fg-strong">
                            {item.title}
                            {item.mono && (
                                <span className="font-mono text-[11px] text-fg-soft">{item.mono}</span>
                            )}
                        </p>
                        {item.subtitle && <p className="text-xs text-fg-soft">{item.subtitle}</p>}
                    </div>
                </li>
            ))}
        </ul>
    );
}
