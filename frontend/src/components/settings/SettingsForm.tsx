import { useMemo, useState } from 'react';
import { Eye, EyeOff, Search, X } from 'lucide-react';
import { Field } from '../form/Field';
import {
    isChangedFromDefault,
    organizeSettings,
    SECRET_PLACEHOLDER,
    type FlatSetting,
    type SettingsGroup,
    type SettingsTree
} from '@/settings/types';

const INPUT =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

/** Schema-driven settings editor, shared by Server Configuration and user Preferences.
 *
 * The legacy versions of both screens (src/wwwroot/js/genpage/helpers/settings_editor.js) render
 * label and control as inline siblings, producing ~60 unaligned rows with no search and no way to
 * see what you have changed. This gives them a group sidebar, a search box, aligned two-column
 * rows via the same <Field> primitive as the parameter panel, and a sticky unsaved-changes bar. */
export function SettingsForm(props: {
    tree: SettingsTree;
    /** Called with a map of dotted key -> new value. */
    onSave: (changes: Record<string, unknown>) => Promise<void>;
    saving?: boolean;
    readOnly?: boolean;
}) {
    const { rootSettings, groups, all } = useMemo(() => organizeSettings(props.tree), [props.tree]);
    const [edits, setEdits] = useState<Record<string, unknown>>({});
    const [search, setSearch] = useState('');
    const [activeGroup, setActiveGroup] = useState<string>('');
    const [revealed, setRevealed] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);

    const query = search.trim().toLowerCase();
    const dirtyKeys = Object.keys(edits);

    function valueOf(setting: FlatSetting): unknown {
        return setting.key in edits ? edits[setting.key] : setting.node.value;
    }

    function matches(setting: FlatSetting): boolean {
        if (!query) {
            return true;
        }
        return `${setting.key} ${setting.node.name} ${setting.node.description}`
            .toLowerCase()
            .includes(query);
    }

    // Searching flattens across every group so hits are never hidden behind the sidebar selection.
    const searchResults = useMemo(() => (query ? all.filter(matches) : []), [query, all, edits]);

    const visibleGroup = useMemo(() => {
        if (!activeGroup) {
            return null;
        }
        function find(list: SettingsGroup[]): SettingsGroup | null {
            for (const group of list) {
                if (group.key === activeGroup) {
                    return group;
                }
                const inner = find(group.children);
                if (inner) {
                    return inner;
                }
            }
            return null;
        }
        return find(groups);
    }, [activeGroup, groups]);

    async function save() {
        setError(null);
        try {
            await props.onSave(edits);
            setEdits({});
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save settings.');
        }
    }

    function renderSetting(setting: FlatSetting) {
        const { node, key } = setting;
        const value = valueOf(setting);
        const dirty = key in edits;
        const changed = dirty || isChangedFromDefault(node, value);

        return (
            <Field
                key={key}
                id={`setting-${key}`}
                label={node.name}
                description={
                    node.description
                        ? `${node.description}\n\nKey: ${key}`
                        : `Key: ${key}`
                }
                density="compact"
                modified={changed}
                disabled={props.readOnly}
                onReset={
                    node.default_value !== undefined && !node.is_secret
                        ? () => setEdits(e => ({ ...e, [key]: node.default_value }))
                        : undefined
                }
            >
                {renderControl(setting, value)}
            </Field>
        );
    }

    function renderControl(setting: FlatSetting, value: unknown) {
        const { node, key } = setting;
        const set = (v: unknown) => setEdits(e => ({ ...e, [key]: v }));
        const disabled = props.readOnly;

        if (node.is_secret) {
            const isSet = node.value === SECRET_PLACEHOLDER;
            return (
                <div className="flex items-center gap-1">
                    <input
                        id={`setting-${key}`}
                        type={revealed[key] ? 'text' : 'password'}
                        value={key in edits ? String(value ?? '') : ''}
                        placeholder={isSet ? '(set — type to replace)' : '(not set)'}
                        disabled={disabled}
                        onChange={e => set(e.target.value)}
                        className={`${INPUT} min-w-0 flex-1`}
                    />
                    <button
                        type="button"
                        onClick={() => setRevealed(r => ({ ...r, [key]: !r[key] }))}
                        aria-label={revealed[key] ? 'Hide value' : 'Show value'}
                        className="shrink-0 rounded border border-default p-1.5 text-fg-soft hover:text-fg"
                    >
                        {revealed[key] ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                    </button>
                </div>
            );
        }

        if (node.values && node.values.length > 0) {
            return (
                <select
                    id={`setting-${key}`}
                    value={String(value ?? '')}
                    disabled={disabled}
                    onChange={e => set(e.target.value)}
                    className={`${INPUT} w-full`}
                >
                    {node.values.map((option, i) => (
                        <option key={option} value={option}>
                            {node.value_names?.[i] || option}
                        </option>
                    ))}
                </select>
            );
        }

        switch (node.type) {
            case 'boolean':
                return (
                    <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                            id={`setting-${key}`}
                            type="checkbox"
                            checked={value === true || value === 'true'}
                            disabled={disabled}
                            onChange={e => set(e.target.checked)}
                            className="accent-[var(--emphasis)]"
                        />
                        <span className="text-sm text-fg-soft">
                            {value === true || value === 'true' ? 'On' : 'Off'}
                        </span>
                    </label>
                );
            case 'integer':
            case 'decimal':
                return (
                    <input
                        id={`setting-${key}`}
                        type="number"
                        step={node.type === 'integer' ? 1 : 'any'}
                        value={String(value ?? 0)}
                        disabled={disabled}
                        onChange={e => set(node.type === 'integer' ? parseInt(e.target.value, 10) || 0 : Number(e.target.value))}
                        className={`${INPUT} w-32`}
                    />
                );
            case 'list':
                return (
                    <textarea
                        id={`setting-${key}`}
                        rows={2}
                        value={String(value ?? '')}
                        disabled={disabled}
                        onChange={e => set(e.target.value)}
                        placeholder="Separate entries with ||"
                        className={`${INPUT} w-full resize-y font-mono text-xs`}
                    />
                );
            default:
                return (
                    <input
                        id={`setting-${key}`}
                        type="text"
                        value={String(value ?? '')}
                        disabled={disabled}
                        onChange={e => set(e.target.value)}
                        className={`${INPUT} w-full`}
                    />
                );
        }
    }

    return (
        <div className="flex h-full min-h-0" style={{ ['--sw-field-label-width' as string]: '14rem' }}>
            <nav
                aria-label="Settings groups"
                className="w-56 shrink-0 overflow-y-auto border-r border-subtle p-2"
            >
                <GroupButton
                    label="General"
                    active={activeGroup === ''}
                    count={countDirty(rootSettings, edits)}
                    onClick={() => setActiveGroup('')}
                />
                {groups.map(group => (
                    <GroupTree
                        key={group.key}
                        group={group}
                        activeGroup={activeGroup}
                        edits={edits}
                        onSelect={setActiveGroup}
                    />
                ))}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-subtle p-2">
                    <div className="relative max-w-md">
                        <Search
                            size={14}
                            aria-hidden
                            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                        />
                        <input
                            type="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search all settings…"
                            aria-label="Search settings"
                            className={`${INPUT} w-full pl-7 pr-7`}
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
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {query ? (
                        searchResults.length === 0 ? (
                            <p className="py-6 text-center text-sm text-fg-soft">
                                No settings match "{search.trim()}".
                            </p>
                        ) : (
                            <>
                                <p className="mb-2 text-xs text-fg-soft">
                                    {searchResults.length} matching {searchResults.length === 1 ? 'setting' : 'settings'}
                                </p>
                                {searchResults.map(renderSetting)}
                            </>
                        )
                    ) : visibleGroup ? (
                        <GroupBody group={visibleGroup} renderSetting={renderSetting} />
                    ) : (
                        <>
                            <h2 className="mb-2 text-sm font-medium text-fg-strong">General</h2>
                            {rootSettings.map(renderSetting)}
                        </>
                    )}
                </div>

                {dirtyKeys.length > 0 && !props.readOnly && (
                    <div className="shrink-0 border-t border-subtle bg-surface-raised px-4 py-2">
                        {error && (
                            <p className="mb-1.5 text-xs" style={{ color: 'var(--backend-errored)' }}>
                                {error}
                            </p>
                        )}
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-fg">
                                {dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? 'change' : 'changes'}
                            </span>
                            <div className="flex-1" />
                            <button
                                type="button"
                                onClick={() => setEdits({})}
                                disabled={props.saving}
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                onClick={save}
                                disabled={props.saving}
                                className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                            >
                                {props.saving ? 'Saving…' : 'Save changes'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function GroupBody(props: { group: SettingsGroup; renderSetting: (s: FlatSetting) => React.ReactNode }) {
    return (
        <section className="mb-4">
            <h2 className="text-sm font-medium text-fg-strong">{props.group.name}</h2>
            {props.group.description && (
                <p className="mb-2 whitespace-pre-wrap text-xs text-fg-soft">{props.group.description}</p>
            )}
            {props.group.settings.map(props.renderSetting)}
            {props.group.children.map(child => (
                <div key={child.key} className="mt-4 border-l border-subtle pl-3">
                    <GroupBody group={child} renderSetting={props.renderSetting} />
                </div>
            ))}
        </section>
    );
}

function GroupTree(props: {
    group: SettingsGroup;
    activeGroup: string;
    edits: Record<string, unknown>;
    onSelect: (key: string) => void;
    depth?: number;
}) {
    const depth = props.depth ?? 0;
    return (
        <>
            <GroupButton
                label={props.group.name}
                active={props.activeGroup === props.group.key}
                count={countDirty(props.group.settings, props.edits)}
                depth={depth}
                onClick={() => props.onSelect(props.group.key)}
            />
            {props.group.children.map(child => (
                <GroupTree
                    key={child.key}
                    group={child}
                    activeGroup={props.activeGroup}
                    edits={props.edits}
                    onSelect={props.onSelect}
                    depth={depth + 1}
                />
            ))}
        </>
    );
}

function GroupButton(props: {
    label: string;
    active: boolean;
    count: number;
    depth?: number;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-current={props.active ? 'page' : undefined}
            style={{ paddingLeft: `${0.5 + (props.depth ?? 0) * 0.75}rem` }}
            className={[
                'flex w-full items-center gap-1.5 rounded py-1.5 pr-2 text-left text-sm transition-colors',
                props.active
                    ? 'bg-[var(--sw-active)] text-fg-strong'
                    : 'text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
            ].join(' ')}
        >
            <span className="min-w-0 flex-1 truncate">{props.label}</span>
            {props.count > 0 && (
                <span
                    title={`${props.count} unsaved`}
                    className="shrink-0 rounded-full px-1.5 text-[10px] leading-4 text-fg-strong"
                    style={{ background: 'var(--sw-chip-bg)' }}
                >
                    {props.count}
                </span>
            )}
        </button>
    );
}

function countDirty(settings: FlatSetting[], edits: Record<string, unknown>): number {
    return settings.filter(s => s.key in edits).length;
}
