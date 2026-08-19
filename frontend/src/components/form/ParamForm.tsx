import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useCurrentStatus, useSession, useT2IParams } from '@/api/hooks';
import { useParamSchema } from '@/params/schema';
import { computeVisibility, type FilterMode } from '@/params/visibility';
import { useParamStore } from '@/params/store';
import { ParamField, ParamGroup } from './ParamGroup';

const MODES: { id: FilterMode; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'modified', label: 'Modified' },
    { id: 'advanced', label: 'Advanced' }
];

/** The generation parameter panel: search, filter chips, then the group tree.
 *
 * Replaces the legacy left sidebar (#main_inputs_area), where the only affordances were a text
 * filter and a "Display Advanced Options? (80)" checkbox. */
export function ParamForm() {
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const status = useCurrentStatus(session.isSuccess);
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState<FilterMode>('all');

    const values = useParamStore(s => s.values);
    const toggles = useParamStore(s => s.toggles);
    const groupToggles = useParamStore(s => s.groupToggles);
    const resetAll = useParamStore(s => s.resetAll);

    const schema = useParamSchema();

    const visibility = useMemo(() => {
        if (!schema) {
            return null;
        }
        return computeVisibility({
            schema,
            values,
            toggles,
            groupToggles,
            supportedFeatures: status.data?.supported_features ?? [],
            search,
            mode
        });
    }, [schema, values, toggles, groupToggles, status.data?.supported_features, search, mode]);

    if (params.isPending) {
        return <p className="p-4 text-sm text-fg-soft">Loading parameters…</p>;
    }
    if (params.isError) {
        return (
            <p className="p-4 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {params.error instanceof Error ? params.error.message : 'Failed to load parameters.'}
            </p>
        );
    }
    if (!schema || !visibility) {
        return null;
    }

    const modifiedCount = visibility.altered.size;
    const visibleUngrouped = schema.ungrouped.filter(p => visibility.visible.has(p.id));
    const searching = search.trim().length > 0;

    return (
        // The panel is narrow, so it overrides the default label column width. The wide settings
        // screens in Phase 5 keep the roomier default from tokens.css.
        <div className="flex flex-col h-full min-h-0" style={{ ['--sw-field-label-width' as string]: '6.5rem' }}>
            <div className="shrink-0 p-2 border-b border-subtle space-y-2">
                <div className="relative">
                    <Search
                        size={14}
                        aria-hidden
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft pointer-events-none"
                    />
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter parameters…"
                        aria-label="Filter parameters"
                        className="w-full rounded border border-default bg-surface-sunken pl-7 pr-7 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                    {searching && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            aria-label="Clear filter"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <X size={13} aria-hidden />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    {MODES.map(entry => {
                        const active = mode === entry.id;
                        const count =
                            entry.id === 'modified'
                                ? modifiedCount
                                : entry.id === 'advanced'
                                  ? visibility.advancedHiddenCount
                                  : null;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => setMode(entry.id)}
                                aria-pressed={active}
                                className={[
                                    'rounded-full border px-2 py-0.5 text-xs transition-colors',
                                    active
                                        ? 'border-transparent bg-[var(--emphasis)] text-[var(--sw-accent-fg)]'
                                        : 'border-default text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]'
                                ].join(' ')}
                            >
                                {entry.label}
                                {count !== null && count > 0 && (
                                    <span className="ml-1 opacity-70">{count}</span>
                                )}
                            </button>
                        );
                    })}
                    <div className="flex-1" />
                    {modifiedCount > 0 && (
                        <button
                            type="button"
                            onClick={resetAll}
                            className="rounded px-1.5 py-0.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                        >
                            Reset all
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {visibleUngrouped.map(param => (
                    <ParamField key={param.id} param={param} schema={schema} visibility={visibility} />
                ))}
                {schema.tree.map(node => (
                    <ParamGroup
                        key={node.group.id}
                        node={node}
                        schema={schema}
                        visibility={visibility}
                        forceOpen={searching}
                    />
                ))}
                {visibility.visible.size === 0 && (
                    <p className="px-2 py-6 text-center text-sm text-fg-soft">
                        {searching ? `No parameters match "${search.trim()}".` : 'No parameters to show.'}
                    </p>
                )}
            </div>

            <div className="shrink-0 border-t border-subtle px-3 py-1.5 text-xs text-fg-soft">
                {visibility.visible.size} of {schema.params.length} shown
                {modifiedCount > 0 && ` · ${modifiedCount} changed`}
            </div>
        </div>
    );
}
