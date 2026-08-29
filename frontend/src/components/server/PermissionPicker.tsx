import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
    groupPermissions,
    safetyLevel,
    WILDCARD_PERMISSION,
    type PermissionInfo
} from '@/server/users';
import { useTranslation } from '@/i18n';

/** The permission grid inside the role editor: ~70 toggles, grouped in the server's own ordering,
 *  each row carrying its safety level and default audience, and the whole list filterable. */
export function PermissionPicker(props: {
    ordered: string[];
    info: Record<string, PermissionInfo>;
    selected: string[];
    disabled?: boolean;
    onToggle: (id: string, on: boolean) => void;
}) {
    const { t, tDynamic } = useTranslation();
    const [search, setSearch] = useState('');
    const query = search.trim().toLowerCase();
    const selected = useMemo(() => new Set(props.selected), [props.selected]);
    // The wildcard subsumes everything else, so showing 70 unchecked boxes beside it would lie.
    const wildcard = selected.has(WILDCARD_PERMISSION);

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
                    return `${id} ${tDynamic(perm.name)} ${tDynamic(perm.description)}`
                        .toLowerCase()
                        .includes(query);
                })
            }))
            .filter(group => group.ids.length > 0);
    }, [props.ordered, props.info, query, tDynamic]);

    const matchCount = groups.reduce((sum, group) => sum + group.ids.length, 0);

    return (
        <div>
            <div className="mb-2 flex items-center gap-2">
                <div className="relative min-w-40 max-w-sm flex-1">
                    <Search
                        size={13}
                        aria-hidden
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                    />
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('permissions.filterPlaceholder')}
                        aria-label={t('permissions.filterLabel')}
                        className="w-full rounded border border-default bg-surface-sunken py-1 pl-7 pr-6 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            aria-label={t('permissions.clearFilter')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                        >
                            <X size={12} aria-hidden />
                        </button>
                    )}
                </div>
                <span className="text-xs text-fg-soft">
                    {t('permissions.grantedCount', {
                        count: props.selected.length,
                        total: props.ordered.length
                    })}
                </span>
            </div>

            {wildcard && (
                <p
                    className="mb-2 rounded border px-2 py-1.5 text-xs"
                    style={{
                        borderColor: 'color-mix(in srgb, var(--backend-errored) 40%, transparent)',
                        background: 'color-mix(in srgb, var(--backend-errored) 12%, transparent)',
                        color: 'var(--text)'
                    }}
                >
                    {t('permissions.wildcardBefore')} <code className="font-mono">*</code>{' '}
                    {t('permissions.wildcardAfter')}
                </p>
            )}

            {query && matchCount === 0 && (
                <p className="py-4 text-sm text-fg-soft">
                    {t('permissions.noMatches', { search: search.trim() })}
                </p>
            )}

            {groups.map(group => (
                <section key={group.name} className="mb-3 last:mb-0">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-fg-soft">
                        {tDynamic(group.name)}
                    </h4>
                    {group.description && (
                        <p className="mb-1 text-xs text-fg-soft opacity-70">
                            {tDynamic(group.description)}
                        </p>
                    )}
                    <ul className="rounded border border-default divide-y divide-[var(--light-border)]">
                        {group.ids.map(id => (
                            <PermissionRow
                                key={id}
                                id={id}
                                perm={props.info[id]}
                                checked={selected.has(id)}
                                impliedByWildcard={wildcard && id !== WILDCARD_PERMISSION}
                                disabled={props.disabled}
                                onToggle={on => props.onToggle(id, on)}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function PermissionRow(props: {
    id: string;
    perm: PermissionInfo;
    checked: boolean;
    impliedByWildcard: boolean;
    disabled?: boolean;
    onToggle: (on: boolean) => void;
}) {
    const { t, tDynamic } = useTranslation();
    const safety = safetyLevel(props.perm.safety_level);
    return (
        <li className="flex items-start gap-3 px-2 py-1.5">
            <input
                id={`perm-${props.id}`}
                type="checkbox"
                checked={props.checked}
                disabled={props.disabled}
                onChange={e => props.onToggle(e.target.checked)}
                className="mt-1 shrink-0 accent-[var(--emphasis)]"
            />
            <div className="min-w-0 flex-1">
                <label
                    htmlFor={`perm-${props.id}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-fg-strong"
                >
                    {tDynamic(props.perm.name)}
                    <span className="font-mono text-[11px] text-fg-soft">{props.id}</span>
                    {safety && <SafetyTag level={props.perm.safety_level} />}
                    {props.impliedByWildcard && (
                        <span className="text-[10px] text-fg-soft">{t('permissions.grantedByWildcard')}</span>
                    )}
                </label>
                <p className="whitespace-pre-wrap text-xs text-fg-soft">
                    {tDynamic(props.perm.description)}
                </p>
                {props.perm.alt_safety_text && (
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--status-bar-warn-color-start-end)' }}>
                        {tDynamic(props.perm.alt_safety_text)}
                    </p>
                )}
            </div>
        </li>
    );
}

/** Safety level chip. Powerful and risky read as warnings; the other two stay quiet. */
export function SafetyTag(props: { level: string }) {
    const safety = safetyLevel(props.level);
    if (!safety) {
        return null;
    }
    return (
        <span
            title={safety.note}
            className="rounded-full px-1.5 py-0.5 text-[10px] leading-none"
            style={
                safety.danger
                    ? {
                          background: 'color-mix(in srgb, var(--backend-errored) 18%, transparent)',
                          color: 'var(--text)'
                      }
                    : { background: 'var(--background-soft)', color: 'var(--sw-fg-soft)' }
            }
        >
            {safety.label}
        </span>
    );
}
