import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api } from '@/api/client';
import { useSession, useT2IParams } from '@/api/hooks';
import { normalizeSchema } from '@/params/schema';
import type { ParamSchema } from '@/api/types';
import { Field } from '@/components/form/Field';

/** Per-parameter overrides, keyed by param id, in the shape SetParamEdits expects. */
type Edits = Record<string, Record<string, unknown>>;

const FLAG_FIELDS = [
    { key: 'visible', label: 'Visible normally' },
    { key: 'advanced', label: 'Advanced' },
    { key: 'do_not_save', label: 'Do not save' },
    { key: 'toggleable', label: 'Toggleable' }
] as const;

/** Parameter Configuration.
 *
 * The legacy screen renders ~253 rows each carrying 8-10 inline controls with mid-line labels,
 * producing an unreadable and unnavigable wall. This shows the same information as a scannable
 * table and moves editing into a side sheet, so only one parameter's controls are on screen. */
export function ParameterConfigPage() {
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const queryClient = useQueryClient();

    const [search, setSearch] = useState('');
    const [groupFilter, setGroupFilter] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [edits, setEdits] = useState<Edits>({});

    const schema = useMemo(() => (params.data ? normalizeSchema(params.data) : null), [params.data]);

    const save = useMutation({
        mutationFn: (next: Edits) => api.post('SetParamEdits', { edits: { params: next, groups: {} } }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['t2i-params'] })
    });

    const rows = useMemo(() => {
        if (!schema) {
            return [];
        }
        const query = search.trim().toLowerCase();
        return schema.params.filter(param => {
            if (groupFilter && (param.group ?? '') !== groupFilter) {
                return false;
            }
            if (!query) {
                return true;
            }
            return `${param.id} ${param.name} ${param.description}`.toLowerCase().includes(query);
        });
    }, [schema, search, groupFilter]);

    if (params.isPending) {
        return <p className="p-6 text-sm text-fg-soft">Loading parameters…</p>;
    }
    if (!schema) {
        return (
            <p className="p-6 text-sm" style={{ color: 'var(--backend-errored)' }}>
                Failed to load parameters.
            </p>
        );
    }

    const selected = selectedId ? schema.byId.get(selectedId) : undefined;
    const dirtyCount = Object.keys(edits).length;

    /** Effective value of a field, preferring an unsaved edit. */
    function effective<K extends keyof ParamSchema>(param: ParamSchema, key: K): ParamSchema[K] {
        const edit = edits[param.id];
        return edit && key in edit ? (edit[key as string] as ParamSchema[K]) : param[key];
    }

    function setEdit(id: string, key: string, value: unknown) {
        setEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: value } }));
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-subtle px-4 py-2">
                <p className="mb-2 text-xs text-fg-soft">
                    Raw internal configuration of generation parameters. Changing these affects how
                    parameters appear in the Generate workspace, not what they do.
                </p>
                <div className="flex flex-wrap items-center gap-2">
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
                            placeholder="Search parameters…"
                            aria-label="Search parameters"
                            className="w-full rounded border border-default bg-surface-sunken py-1 pl-7 pr-7 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                aria-label="Clear search"
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                            >
                                <X size={13} aria-hidden />
                            </button>
                        )}
                    </div>
                    <select
                        value={groupFilter}
                        onChange={e => setGroupFilter(e.target.value)}
                        aria-label="Filter by group"
                        className="rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    >
                        <option value="">All groups</option>
                        {[...schema.groupsById.values()].map(group => (
                            <option key={group.id} value={group.id}>
                                {group.name}
                            </option>
                        ))}
                    </select>
                    <span className="text-xs text-fg-soft tabular-nums">
                        {rows.length} of {schema.params.length}
                    </span>
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-auto">
                    <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10 bg-surface">
                            <tr className="border-b border-default text-left text-xs text-fg-soft">
                                <Th>Name</Th>
                                <Th>Group</Th>
                                <Th className="text-right">Priority</Th>
                                <Th>Flags</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(param => {
                                const group = param.group ? schema.groupsById.get(param.group) : undefined;
                                const isDirty = param.id in edits;
                                return (
                                    <tr
                                        key={param.id}
                                        onClick={() => setSelectedId(param.id)}
                                        aria-selected={selectedId === param.id}
                                        className="cursor-pointer border-b border-[var(--light-border)] hover:bg-[var(--sw-hover)]"
                                        style={
                                            selectedId === param.id ? { background: 'var(--sw-active)' } : undefined
                                        }
                                    >
                                        <Td>
                                            <span className="flex items-center gap-1.5">
                                                {isDirty && (
                                                    <span
                                                        title="Unsaved change"
                                                        className="size-1.5 shrink-0 rounded-full"
                                                        style={{ background: 'var(--sw-modified)' }}
                                                    />
                                                )}
                                                <span className="text-fg">{param.name}</span>
                                                <span className="font-mono text-[11px] text-fg-soft">{param.id}</span>
                                            </span>
                                        </Td>
                                        <Td className="text-fg-soft">{group?.name ?? '—'}</Td>
                                        <Td className="text-right tabular-nums text-fg-soft">
                                            {String(effective(param, 'priority'))}
                                        </Td>
                                        <Td>
                                            <span className="flex flex-wrap gap-1">
                                                {effective(param, 'advanced') && <Flag label="advanced" />}
                                                {!effective(param, 'visible') && <Flag label="hidden" />}
                                                {effective(param, 'toggleable') && <Flag label="toggleable" />}
                                                {effective(param, 'do_not_save') && <Flag label="no-save" />}
                                            </span>
                                        </Td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {rows.length === 0 && (
                        <p className="p-6 text-center text-sm text-fg-soft">No parameters match.</p>
                    )}
                </div>

                {selected && (
                    <aside
                        aria-label="Parameter settings"
                        className="flex w-96 shrink-0 flex-col border-l border-subtle bg-surface"
                        style={{ ['--sw-field-label-width' as string]: '9rem' }}
                    >
                        <div className="flex shrink-0 items-start gap-2 border-b border-subtle p-3">
                            <div className="min-w-0 flex-1">
                                <h2 className="truncate text-sm font-medium text-fg-strong">{selected.name}</h2>
                                <p className="truncate font-mono text-[11px] text-fg-soft">{selected.id}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedId(null)}
                                aria-label="Close"
                                className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                <X size={15} aria-hidden />
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            {selected.description && (
                                <p className="mb-3 whitespace-pre-wrap text-xs text-fg-soft">
                                    {selected.description}
                                </p>
                            )}

                            <Field id="priority" label="Ordering priority" density="compact">
                                <input
                                    type="number"
                                    value={String(effective(selected, 'priority'))}
                                    onChange={e => setEdit(selected.id, 'priority', Number(e.target.value))}
                                    className="w-24 rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                />
                            </Field>

                            <Field id="group" label="Group" density="compact">
                                <select
                                    value={String(effective(selected, 'group') ?? '')}
                                    onChange={e => setEdit(selected.id, 'group', e.target.value || null)}
                                    className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                >
                                    <option value="">(ungrouped)</option>
                                    {[...schema.groupsById.values()].map(group => (
                                        <option key={group.id} value={group.id}>
                                            {group.name}
                                        </option>
                                    ))}
                                </select>
                            </Field>

                            {FLAG_FIELDS.map(flag => (
                                <Field key={flag.key} id={flag.key} label={flag.label} density="compact">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(effective(selected, flag.key))}
                                        onChange={e => setEdit(selected.id, flag.key, e.target.checked)}
                                        className="accent-[var(--emphasis)]"
                                    />
                                </Field>
                            ))}

                            <Field id="examples" label="Examples" density="compact">
                                <textarea
                                    rows={3}
                                    value={(effective(selected, 'examples') ?? []).join(' || ')}
                                    onChange={e => setEdit(selected.id, 'examples', e.target.value)}
                                    placeholder="Separate with ||"
                                    className="w-full resize-y rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                />
                            </Field>

                            {selected.id in edits && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setEdits(prev => {
                                            const next = { ...prev };
                                            delete next[selected.id];
                                            return next;
                                        })
                                    }
                                    className="mt-2 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    Revert this parameter
                                </button>
                            )}
                        </div>
                    </aside>
                )}
            </div>

            {dirtyCount > 0 && (
                <div className="flex shrink-0 items-center gap-3 border-t border-subtle bg-surface-raised px-4 py-2">
                    <span className="text-sm text-fg">
                        {dirtyCount} {dirtyCount === 1 ? 'parameter' : 'parameters'} changed
                    </span>
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={() => setEdits({})}
                        className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                    >
                        Discard
                    </button>
                    <button
                        type="button"
                        onClick={() => save.mutate(edits, { onSuccess: () => setEdits({}) })}
                        disabled={save.isPending}
                        className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                        style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                    >
                        {save.isPending ? 'Saving…' : 'Save changes'}
                    </button>
                </div>
            )}
        </div>
    );
}

function Th(props: { children: React.ReactNode; className?: string }) {
    return <th className={`px-3 py-1.5 font-medium ${props.className ?? ''}`}>{props.children}</th>;
}

function Td(props: { children: React.ReactNode; className?: string }) {
    return <td className={`px-3 py-1.5 ${props.className ?? ''}`}>{props.children}</td>;
}

function Flag(props: { label: string }) {
    return (
        <span
            className="rounded-full px-1.5 py-0.5 text-[10px] leading-none text-fg-soft"
            style={{ background: 'var(--background-soft)' }}
        >
            {props.label}
        </span>
    );
}
