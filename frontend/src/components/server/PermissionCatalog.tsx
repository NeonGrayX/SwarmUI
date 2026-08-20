import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { SafetyTag } from '@/components/server/PermissionPicker';
import {
    groupPermissions,
    PERMISSION_DEFAULT_LABEL,
    type PermissionInfo,
    type RoleInfo
} from '@/server/users';

/** Read-only reference for every registered permission.
 *
 * The legacy UI has no equivalent — permissions only ever appear as unlabelled toggles inside one
 * role, so there is no way to ask "what is this permission, and who currently has it?". Listing
 * the roles that grant each one answers that without opening every role in turn. */
export function PermissionCatalog(props: {
    ordered: string[];
    info: Record<string, PermissionInfo>;
    roles: Record<string, RoleInfo>;
}) {
    const [search, setSearch] = useState('');
    const query = search.trim().toLowerCase();

    // Inverted index: permission id -> the roles granting it. Built once per role change.
    const grantedBy = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const [id, role] of Object.entries(props.roles)) {
            for (const perm of role.permissions) {
                map.set(perm, [...(map.get(perm) ?? []), role.name || id]);
            }
        }
        return map;
    }, [props.roles]);

    const groups = useMemo(() => {
        const all = groupPermissions(props.ordered, props.info);
        if (!query) {
            return all;
        }
        return all
            .map(group => ({
                ...group,
                ids: group.ids.filter(id => {
                    const perm = props.info[id];
                    return `${id} ${perm.name} ${perm.description} ${group.name}`
                        .toLowerCase()
                        .includes(query);
                })
            }))
            .filter(group => group.ids.length > 0);
    }, [props.ordered, props.info, query]);

    const matchCount = groups.reduce((sum, group) => sum + group.ids.length, 0);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-2">
                <div className="relative min-w-48 max-w-sm flex-1">
                    <Search
                        size={14}
                        aria-hidden
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                    />
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search permissions…"
                        aria-label="Search permissions"
                        className="w-full rounded border border-default bg-surface-sunken py-1 pl-7 pr-6 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            aria-label="Clear search"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                        >
                            <X size={12} aria-hidden />
                        </button>
                    )}
                </div>
                <span className="text-xs text-fg-soft">
                    {query ? `${matchCount} of ${props.ordered.length}` : `${props.ordered.length} registered`}
                </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="mb-3 text-xs text-fg-soft">
                    Permissions are granted through roles, not to users directly. Edit a role to change
                    who holds one.
                </p>

                {query && matchCount === 0 && (
                    <p className="text-sm text-fg-soft">No permissions match "{search.trim()}".</p>
                )}

                {groups.map(group => (
                    <section key={group.name} className="mb-4 last:mb-0">
                        <h3 className="text-sm font-medium text-fg-strong">{group.name}</h3>
                        {group.description && (
                            <p className="mb-1.5 text-xs text-fg-soft">{group.description}</p>
                        )}
                        <ul className="rounded-lg border border-default bg-surface divide-y divide-[var(--light-border)]">
                            {group.ids.map(id => {
                                const perm = props.info[id];
                                const holders = grantedBy.get(id) ?? [];
                                return (
                                    <li key={id} className="px-3 py-2">
                                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-fg-strong">
                                            {perm.name}
                                            <span className="font-mono text-[11px] text-fg-soft">{id}</span>
                                            <SafetyTag level={perm.safety_level} />
                                            <span className="text-[11px] text-fg-soft">
                                                default: {PERMISSION_DEFAULT_LABEL[perm.default] ?? perm.default}
                                            </span>
                                        </p>
                                        <p className="whitespace-pre-wrap text-xs text-fg-soft">
                                            {perm.description}
                                        </p>
                                        {perm.alt_safety_text && (
                                            <p
                                                className="mt-0.5 text-xs"
                                                style={{ color: 'var(--status-bar-warn-color-start-end)' }}
                                            >
                                                {perm.alt_safety_text}
                                            </p>
                                        )}
                                        <p className="mt-0.5 text-xs text-fg-soft opacity-80">
                                            {holders.length > 0
                                                ? `Held by: ${holders.join(', ')}`
                                                : 'Held by no role.'}
                                        </p>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
