import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Search, X } from 'lucide-react';
import { api } from '@/api/client';
import { useSession, useT2IParams } from '@/api/hooks';
import { normalizeSchema, type NormalizedSchema, type ParamEdits } from '@/params/schema';
import type { ParamSchema } from '@/api/types';
import { Field } from '@/components/form/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTranslation } from '@/i18n';

/** One param's complete override record, in the shape SetParamEdits stores it. An empty record
 *  means "no overrides at all", ie reset to what the parameter shipped with. */
type ParamEdit = Record<string, unknown>;

/** Pending, unsaved override records keyed by param id. Each entry replaces the saved record
 *  wholesale rather than layering on it, so a reset is simply an empty entry. */
type Pending = Record<string, ParamEdit>;

const FLAG_FIELDS = [
    { key: 'visible', labelKey: 'paramConfig.flag.visible' },
    { key: 'advanced', labelKey: 'paramConfig.flag.advanced' },
    { key: 'do_not_save', labelKey: 'paramConfig.flag.doNotSave' },
    { key: 'toggleable', labelKey: 'paramConfig.flag.toggleable' }
] as const;

/** The shipped value of a field in the shape the edit blob stores it — `examples` lives as a
 *  '||'-separated string there but as an array in the schema. */
function shippedEditValue(original: ParamSchema, key: string): unknown {
    if (key === 'examples') {
        return (original.examples ?? []).join(' || ');
    }
    if (key === 'default' && original.type === 'boolean') {
        // The editor offers exactly 'true'/'false'; a boolean that ships with neither (an empty
        // default) still means false, and picking false is not an override of it.
        return original.default === 'true' || original.default === 'True' ? 'true' : 'false';
    }
    return original[key as keyof ParamSchema];
}

function sameEditValue(a: unknown, b: unknown): boolean {
    return String(a ?? '') === String(b ?? '');
}

function sameRecord(a: ParamEdit, b: ParamEdit): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if (!(key in a) || !(key in b) || !sameEditValue(a[key], b[key])) {
            return false;
        }
    }
    return true;
}

/** Parameter Configuration.
 *
 * The legacy screen renders ~253 rows each carrying 8-10 inline controls with mid-line labels,
 * producing an unreadable and unnavigable wall. This shows the same information as a scannable
 * table and moves editing into a side sheet, so only one parameter's controls are on screen. */
export function ParameterConfigPage() {
    const { t, tDynamic } = useTranslation();
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const queryClient = useQueryClient();

    const [search, setSearch] = useState('');
    const [groupFilter, setGroupFilter] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pending, setPending] = useState<Pending>({});
    const [confirmResetAll, setConfirmResetAll] = useState(false);

    const schema = useMemo(() => (params.data ? normalizeSchema(params.data) : null), [params.data]);
    const saved = (params.data?.param_edits ?? {}) as ParamEdits;
    const savedParams = saved.params ?? {};

    // The blob is stored whole, so a save has to carry every override the server already holds -
    // including the group edits this screen does not touch, which the legacy UI can still write.
    const save = useMutation({
        mutationFn: (next: ParamEdits) => api.post('SetParamEdits', { edits: next }),
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
            return `${param.id} ${tDynamic(param.name)} ${tDynamic(param.description)}`
                .toLowerCase()
                .includes(query);
        });
    }, [schema, search, groupFilter, tDynamic]);

    if (params.isPending) {
        return <p className="p-6 text-sm text-fg-soft">{t('params.loading')}</p>;
    }
    if (!schema) {
        return (
            <p className="p-6 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {t('params.loadFailed')}
            </p>
        );
    }

    // Aliased because the helpers below are hoisted function declarations, which TypeScript reads
    // as created before the null check above.
    const loaded = schema;
    const selected = selectedId ? schema.byId.get(selectedId) : undefined;
    const dirtyIds = Object.keys(pending).filter(id => !sameRecord(pending[id], savedParams[id] ?? {}));
    const customizedCount = new Set([...Object.keys(savedParams), ...dirtyIds]).size;

    /** The param as it stands before pending edits: the shipped form once anything is pending for
     *  it (a pending record is complete, not a patch), otherwise the saved-edits form. */
    function baseOf(param: ParamSchema): ParamSchema {
        return param.id in pending ? (loaded.originals.get(param.id) ?? param) : param;
    }

    /** Effective value of a field, preferring an unsaved edit. */
    function effective<K extends keyof ParamSchema>(param: ParamSchema, key: K): ParamSchema[K] {
        const entry = pending[param.id];
        if (entry && key in entry) {
            return entry[key as string] as ParamSchema[K];
        }
        return baseOf(param)[key];
    }

    function examplesText(param: ParamSchema): string {
        const entry = pending[param.id];
        if (entry && 'examples' in entry) {
            return String(entry.examples ?? '');
        }
        return (baseOf(param).examples ?? []).join(' || ');
    }

    function setEdit(param: ParamSchema, key: string, value: unknown) {
        const original = loaded.originals.get(param.id);
        setPending(prev => {
            const next: ParamEdit = { ...(prev[param.id] ?? savedParams[param.id] ?? {}) };
            // An edit that lands back on the shipped value is not an override, so it is dropped
            // rather than stored - that keeps the blob honest about what is actually customized.
            if (original && sameEditValue(value, shippedEditValue(original, key))) {
                delete next[key];
            }
            else {
                next[key] = value;
            }
            return { ...prev, [param.id]: next };
        });
    }

    /** Stages "back to how it shipped" for one param. Committed by Save, like any other edit. */
    function resetParam(id: string) {
        setPending(prev => ({ ...prev, [id]: {} }));
    }

    function discardParam(id: string) {
        setPending(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }

    function isCustomized(param: ParamSchema): boolean {
        const entry = pending[param.id] ?? savedParams[param.id] ?? {};
        return Object.keys(entry).length > 0;
    }

    function saveAll() {
        const nextParams: Record<string, ParamEdit> = { ...savedParams };
        for (const [id, entry] of Object.entries(pending)) {
            if (Object.keys(entry).length === 0) {
                delete nextParams[id];
            }
            else {
                nextParams[id] = entry;
            }
        }
        const next = { groups: saved.groups ?? {}, params: nextParams } as ParamEdits;
        save.mutate(next, { onSuccess: () => setPending({}) });
    }

    function resetEverything() {
        setConfirmResetAll(false);
        save.mutate({ groups: {}, params: {} }, { onSuccess: () => setPending({}) });
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-subtle px-4 py-2">
                <p className="mb-2 text-xs text-fg-soft">{t('paramConfig.intro')}</p>
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
                            placeholder={t('paramConfig.searchPlaceholder')}
                            aria-label={t('paramConfig.searchLabel')}
                            className="w-full rounded border border-default bg-surface-sunken py-1 pl-7 pr-7 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                aria-label={t('common.clearSearch')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                            >
                                <X size={13} aria-hidden />
                            </button>
                        )}
                    </div>
                    <select
                        value={groupFilter}
                        onChange={e => setGroupFilter(e.target.value)}
                        aria-label={t('paramConfig.filterByGroup')}
                        className="rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    >
                        <option value="">{t('paramConfig.allGroups')}</option>
                        {[...schema.groupsById.values()].map(group => (
                            <option key={group.id} value={group.id}>
                                {tDynamic(group.name)}
                            </option>
                        ))}
                    </select>
                    <span className="text-xs text-fg-soft tabular-nums">
                        {t('modelPicker.countOf', { shown: rows.length, total: schema.params.length })}
                    </span>
                    <div className="flex-1" />
                    <span className="text-xs text-fg-soft tabular-nums">
                        {t('paramConfig.customizedCount', { count: customizedCount })}
                    </span>
                    <button
                        type="button"
                        onClick={() => setConfirmResetAll(true)}
                        disabled={customizedCount === 0 || save.isPending}
                        title={t('paramConfig.resetAllHint')}
                        className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-sm text-fg hover:bg-[var(--sw-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                        <RotateCcw size={13} aria-hidden />
                        {t('params.resetAll')}
                    </button>
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-auto">
                    <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10 bg-surface">
                            <tr className="border-b border-default text-left text-xs text-fg-soft">
                                <Th>{t('paramConfig.column.name')}</Th>
                                <Th>{t('paramConfig.column.group')}</Th>
                                <Th className="text-right">{t('paramConfig.column.priority')}</Th>
                                <Th>{t('paramConfig.column.flags')}</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(param => {
                                const groupId = effective(param, 'group');
                                const group = groupId ? schema.groupsById.get(groupId) : undefined;
                                const isDirty = dirtyIds.includes(param.id);
                                const original = schema.originals.get(param.id);
                                const customDefault =
                                    original !== undefined &&
                                    !sameEditValue(
                                        effective(param, 'default'),
                                        shippedEditValue(original, 'default')
                                    );
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
                                                        title={t('paramConfig.unsavedChange')}
                                                        className="size-1.5 shrink-0 rounded-full"
                                                        style={{ background: 'var(--sw-modified)' }}
                                                    />
                                                )}
                                                <span className="text-fg">{tDynamic(param.name)}</span>
                                                <span className="font-mono text-[11px] text-fg-soft">{param.id}</span>
                                            </span>
                                        </Td>
                                        <Td className="text-fg-soft">
                                            {group ? tDynamic(group.name) : '—'}
                                        </Td>
                                        <Td className="text-right tabular-nums text-fg-soft">
                                            {String(effective(param, 'priority'))}
                                        </Td>
                                        <Td>
                                            <span className="flex flex-wrap gap-1">
                                                {effective(param, 'advanced') && (
                                                    <Flag label={t('paramConfig.tag.advanced')} />
                                                )}
                                                {!effective(param, 'visible') && (
                                                    <Flag label={t('paramConfig.tag.hidden')} />
                                                )}
                                                {effective(param, 'toggleable') && (
                                                    <Flag label={t('paramConfig.tag.toggleable')} />
                                                )}
                                                {effective(param, 'do_not_save') && (
                                                    <Flag label={t('paramConfig.tag.noSave')} />
                                                )}
                                                {customDefault && (
                                                    <Flag label={t('paramConfig.tag.customDefault')} />
                                                )}
                                            </span>
                                        </Td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {rows.length === 0 && (
                        <p className="p-6 text-center text-sm text-fg-soft">
                            {t('paramConfig.noMatches')}
                        </p>
                    )}
                </div>

                {selected && (
                    <aside
                        aria-label={t('paramConfig.settingsLabel')}
                        className="flex w-96 shrink-0 flex-col border-l border-subtle bg-surface"
                        style={{ ['--sw-field-label-width' as string]: '9rem' }}
                    >
                        <div className="flex shrink-0 items-start gap-2 border-b border-subtle p-3">
                            <div className="min-w-0 flex-1">
                                <h2 className="truncate text-sm font-medium text-fg-strong">
                                    {tDynamic(selected.name)}
                                </h2>
                                <p className="truncate font-mono text-[11px] text-fg-soft">{selected.id}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => resetParam(selected.id)}
                                disabled={!isCustomized(selected)}
                                title={t('paramConfig.resetOneHint')}
                                className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
                            >
                                <RotateCcw size={12} aria-hidden />
                                {t('paramConfig.reset')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelectedId(null)}
                                aria-label={t('common.close')}
                                className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                <X size={15} aria-hidden />
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            {selected.description && (
                                <p className="mb-3 whitespace-pre-wrap text-xs text-fg-soft">
                                    {tDynamic(selected.description)}
                                </p>
                            )}

                            <DefaultField
                                param={selected}
                                schema={schema}
                                value={effective(selected, 'default')}
                                onChange={value => setEdit(selected, 'default', value)}
                            />

                            <Field id="priority" label={t('paramConfig.orderingPriority')} density="compact">
                                <input
                                    type="number"
                                    value={String(effective(selected, 'priority'))}
                                    onChange={e => setEdit(selected, 'priority', Number(e.target.value))}
                                    className="w-24 rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                />
                            </Field>

                            <Field id="group" label={t('paramConfig.column.group')} density="compact">
                                <select
                                    value={String(effective(selected, 'group') ?? '')}
                                    onChange={e => setEdit(selected, 'group', e.target.value || null)}
                                    className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                >
                                    <option value="">{t('paramConfig.ungrouped')}</option>
                                    {[...schema.groupsById.values()].map(group => (
                                        <option key={group.id} value={group.id}>
                                            {tDynamic(group.name)}
                                        </option>
                                    ))}
                                </select>
                            </Field>

                            {FLAG_FIELDS.map(flag => (
                                <Field key={flag.key} id={flag.key} label={t(flag.labelKey)} density="compact">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(effective(selected, flag.key))}
                                        onChange={e => setEdit(selected, flag.key, e.target.checked)}
                                        className="accent-[var(--emphasis)]"
                                    />
                                </Field>
                            ))}

                            <Field id="examples" label={t('field.examples')} density="compact">
                                <textarea
                                    rows={3}
                                    value={examplesText(selected)}
                                    onChange={e => setEdit(selected, 'examples', e.target.value)}
                                    placeholder={t('paramConfig.examplesPlaceholder')}
                                    className="w-full resize-y rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                />
                            </Field>

                            {dirtyIds.includes(selected.id) && (
                                <button
                                    type="button"
                                    onClick={() => discardParam(selected.id)}
                                    className="mt-2 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    {t('paramConfig.discardOne')}
                                </button>
                            )}
                        </div>
                    </aside>
                )}
            </div>

            {dirtyIds.length > 0 && (
                <div className="flex shrink-0 items-center gap-3 border-t border-subtle bg-surface-raised px-4 py-2">
                    <span className="text-sm text-fg">
                        {t('paramConfig.changedCount', { count: dirtyIds.length })}
                    </span>
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={() => setPending({})}
                        className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                    >
                        {t('common.discard')}
                    </button>
                    <button
                        type="button"
                        onClick={saveAll}
                        disabled={save.isPending}
                        className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                        style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                    >
                        {save.isPending ? t('common.saving') : t('settings.saveChanges')}
                    </button>
                </div>
            )}

            <ConfirmDialog
                open={confirmResetAll}
                title={t('paramConfig.resetAllTitle')}
                body={t('paramConfig.resetAllBody')}
                confirmLabel={t('params.resetAll')}
                destructive
                onConfirm={resetEverything}
                onCancel={() => setConfirmResetAll(false)}
            />
        </div>
    );
}

/** Editor for a parameter's starting value.
 *
 * This is the value the Generate panel opens on and the value its per-row "Reset to default"
 * restores to, so it is how you make your own preferences the baseline instead of the server's.
 * Deliberately not `ParamControl`: the media and LoRA controls read the generation param store,
 * which has no business being touched from a settings screen. */
function DefaultField(props: {
    param: ParamSchema;
    schema: NormalizedSchema;
    value: string | null;
    onChange: (value: string) => void;
}) {
    const { t, tDynamic } = useTranslation();
    const { param, schema } = props;
    const value = props.value ?? '';
    const original = schema.originals.get(param.id);
    const shipped = original ? String(shippedEditValue(original, 'default') ?? '') : '';
    const inputClass =
        'w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

    const modelList = param.type === 'model' ? (schema.models[param.subtype ?? ''] ?? []) : null;
    const options = param.values ?? modelList;

    let control;
    if (param.type === 'boolean') {
        // Normalized the same way the panel reads it (defaultValue, src/params/store.ts), so a
        // param that ships with no default at all still lands on a real option rather than blank.
        const on = value === 'true' || value === 'True';
        control = (
            <select
                value={on ? 'true' : 'false'}
                onChange={e => props.onChange(e.target.value)}
                className={inputClass}
            >
                <option value="false">false</option>
                <option value="true">true</option>
            </select>
        );
    }
    else if (options) {
        control = (
            <select value={value} onChange={e => props.onChange(e.target.value)} className={inputClass}>
                <option value="">{t('paramConfig.none')}</option>
                {/* A default set before a model was renamed or removed would otherwise vanish
                    silently on the next visit, so it stays in the list until changed. */}
                {value && !options.includes(value) && (
                    <option value={value}>{t('paramConfig.missingOption', { value })}</option>
                )}
                {options.map((option, index) => (
                    <option key={option} value={option}>
                        {param.value_names?.[index] ? tDynamic(param.value_names[index]) : option}
                    </option>
                ))}
            </select>
        );
    }
    else if (param.type === 'integer' || param.type === 'decimal') {
        control = (
            <input
                type="number"
                min={param.min}
                max={param.max}
                step={param.step || 1}
                value={value}
                onChange={e => props.onChange(e.target.value)}
                className={`${inputClass} tabular-nums`}
            />
        );
    }
    else if (param.view_type === 'prompt' || param.view_type === 'big') {
        control = (
            <textarea
                rows={3}
                value={value}
                onChange={e => props.onChange(e.target.value)}
                className={`${inputClass} resize-y`}
            />
        );
    }
    else {
        control = (
            <input
                type="text"
                value={value}
                onChange={e => props.onChange(e.target.value)}
                className={inputClass}
            />
        );
    }

    return (
        <Field
            id="default"
            label={t('paramConfig.defaultValue')}
            description={t('paramConfig.defaultValueHelp')}
            density="compact"
        >
            <div className="min-w-0">
                {control}
                {!sameEditValue(value, shipped) && (
                    <p className="mt-1 text-[11px] text-fg-soft">
                        {t('paramConfig.shipsWith')}{' '}
                        <span className="font-mono">{shipped === '' ? t('paramConfig.none') : shipped}</span>
                    </p>
                )}
            </div>
        </Field>
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
