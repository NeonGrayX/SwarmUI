import { useMemo, useState } from 'react';
import { Copy, ImageOff, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { libraryKeys, useMyUserData } from '@/library/hooks';
import { previewUrl, type PresetEntry, type ViewMode } from '@/library/types';
import { usePermission } from '@/api/permissions';
import { useParamStore } from '@/params/store';
import { BrowserToolbar, EmptyState } from './BrowserChrome';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useContextMenu, type MenuAction } from '../ui/ContextMenu';

/** Saved parameter sets. These come down with GetMyUserData rather than a list endpoint. */
export function PresetsBrowser() {
    const [search, setSearch] = useState('');
    const [view, setView] = useState<ViewMode>('grid');
    const [reverse, setReverse] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

    const userData = useMyUserData();
    const queryClient = useQueryClient();
    const canManage = usePermission('manage_presets');
    const setValue = useParamStore(s => s.setValue);
    const contextMenu = useContextMenu();

    const presets = userData.data?.presets ?? [];
    const shown = useMemo(() => {
        const query = search.trim().toLowerCase();
        const list = query
            ? presets.filter(p => `${p.title} ${p.description}`.toLowerCase().includes(query))
            : presets;
        const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title));
        return reverse ? sorted.reverse() : sorted;
    }, [presets, search, reverse]);

    const ids = useMemo(() => shown.map(preset => preset.title), [shown]);
    const selection = useSelection(ids);

    async function refresh() {
        await queryClient.invalidateQueries({ queryKey: libraryKeys.userData });
    }

    /** Applies a preset's stored parameter map to the generation form. */
    function apply(paramMap: Record<string, unknown> | undefined) {
        for (const [key, value] of Object.entries(paramMap ?? {})) {
            setValue(key, value as never);
        }
    }

    /** Deletes every selected preset. One request each - the API has no batch form. */
    async function deleteSelected(): Promise<void> {
        const targets = selection.ids;
        selection.clear();
        for (const title of targets) {
            await api.post('DeletePreset', { preset: title });
        }
        await refresh();
    }

    /** Everything one preset can do, for its right-click menu. */
    function actionsFor(preset: PresetEntry): MenuAction[] {
        const actions: MenuAction[] = [
            { label: 'Apply parameters', onSelect: () => apply(preset.param_map) }
        ];
        if (canManage) {
            actions.push({
                label: 'Duplicate',
                separated: true,
                onSelect: async () => {
                    await api.post('DuplicatePreset', { preset: preset.title });
                    await refresh();
                }
            });
            actions.push({
                label: 'Delete…',
                destructive: true,
                onSelect: () => setPendingDelete(preset.title)
            });
        }
        return actions;
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <BrowserToolbar
                search={search}
                onSearch={setSearch}
                view={view}
                onView={setView}
                reverse={reverse}
                onReverse={setReverse}
                count={shown.length}
                total={presets.length}
            />

            {selection.count > 0 && (
                <SelectionBar
                    count={selection.count}
                    total={shown.length}
                    onSelectAll={selection.selectAll}
                    onClear={selection.clear}
                >
                    {canManage && (
                        <SelectionButton
                            label="Delete"
                            destructive
                            onClick={() => setPendingBulkDelete(true)}
                        >
                            <Trash2 size={13} aria-hidden />
                        </SelectionButton>
                    )}
                </SelectionBar>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {userData.isPending ? (
                    <EmptyState title="Loading presets…" />
                ) : shown.length === 0 ? (
                    <EmptyState
                        title={search ? `No presets match "${search.trim()}".` : 'No presets saved.'}
                        hint={
                            search
                                ? undefined
                                : 'Set up parameters on the Generate tab, then save them as a preset.'
                        }
                    />
                ) : view === 'grid' ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
                        {shown.map(preset => (
                            <div
                                key={preset.title}
                                className={[
                                    'group relative overflow-hidden rounded-lg border bg-surface',
                                    selection.isSelected(preset.title)
                                        ? 'border-[var(--emphasis)]'
                                        : 'border-default'
                                ].join(' ')}
                                onContextMenu={event => contextMenu.open(event, actionsFor(preset))}
                            >
                                <span className="absolute left-1.5 top-1.5 z-10">
                                    <SelectionCheckbox
                                        overlay
                                        checked={selection.isSelected(preset.title)}
                                        onToggle={() => selection.toggle(preset.title)}
                                        label={`Select ${preset.title}`}
                                    />
                                </span>
                                <button
                                    type="button"
                                    onClick={event =>
                                        selection.click(event, preset.title, () => apply(preset.param_map))
                                    }
                                    title={`Apply "${preset.title}"\nRight-click for actions`}
                                    className="block w-full text-left"
                                >
                                    <div className="flex aspect-video items-center justify-center bg-surface-sunken">
                                        {previewUrl(preset.preview_image) ? (
                                            <img
                                                src={previewUrl(preset.preview_image)}
                                                alt=""
                                                loading="lazy"
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <ImageOff size={20} className="text-fg-soft opacity-40" aria-hidden />
                                        )}
                                    </div>
                                    <div className="p-2">
                                        <p className="truncate text-sm text-fg-strong">{preset.title}</p>
                                        {preset.description && (
                                            <p className="line-clamp-2 text-xs text-fg-soft">{preset.description}</p>
                                        )}
                                        <p className="mt-1 text-[10px] text-fg-soft">
                                            {Object.keys(preset.param_map ?? {}).length} parameters
                                        </p>
                                    </div>
                                </button>
                                {canManage && (
                                    <div className="flex justify-end gap-1 border-t border-subtle px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                        <IconButton
                                            label="Duplicate"
                                            onClick={async () => {
                                                await api.post('DuplicatePreset', { preset: preset.title });
                                                await refresh();
                                            }}
                                        >
                                            <Copy size={13} aria-hidden />
                                        </IconButton>
                                        <IconButton
                                            label="Delete"
                                            destructive
                                            onClick={() => setPendingDelete(preset.title)}
                                        >
                                            <Trash2 size={13} aria-hidden />
                                        </IconButton>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--light-border)]">
                        {shown.map(preset => (
                            <li
                                key={preset.title}
                                className="group flex items-center gap-3 py-2"
                                onContextMenu={event => contextMenu.open(event, actionsFor(preset))}
                            >
                                <SelectionCheckbox
                                    checked={selection.isSelected(preset.title)}
                                    onToggle={() => selection.toggle(preset.title)}
                                    label={`Select ${preset.title}`}
                                />
                                <button
                                    type="button"
                                    onClick={event =>
                                        selection.click(event, preset.title, () => apply(preset.param_map))
                                    }
                                    title={`Apply "${preset.title}"\nRight-click for actions`}
                                    className="min-w-0 flex-1 text-left"
                                >
                                    <p className="truncate text-sm text-fg">{preset.title}</p>
                                    {preset.description && (
                                        <p className="truncate text-xs text-fg-soft">{preset.description}</p>
                                    )}
                                </button>
                                <span className="shrink-0 text-xs text-fg-soft">
                                    {Object.keys(preset.param_map ?? {}).length} params
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Delete preset?"
                body={
                    <>
                        The preset <strong className="text-fg">{pendingDelete}</strong> will be removed.
                        This cannot be undone.
                    </>
                }
                confirmLabel="Delete"
                destructive
                onConfirm={async () => {
                    if (pendingDelete) {
                        await api.post('DeletePreset', { preset: pendingDelete });
                        await refresh();
                    }
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />

            <ConfirmDialog
                open={pendingBulkDelete}
                title={`Delete ${selection.count} presets?`}
                body={
                    <>
                        All <strong className="text-fg">{selection.count}</strong> selected presets will
                        be removed. This cannot be undone.
                    </>
                }
                confirmLabel="Delete"
                destructive
                onConfirm={() => {
                    setPendingBulkDelete(false);
                    void deleteSelected();
                }}
                onCancel={() => setPendingBulkDelete(false)}
            />

            {contextMenu.menu}
        </div>
    );
}

function IconButton(props: {
    label: string;
    onClick: () => void;
    destructive?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            title={props.label}
            className="rounded p-1 hover:bg-[var(--sw-hover)]"
            style={{ color: props.destructive ? 'var(--backend-errored)' : 'var(--sw-fg-soft)' }}
        >
            {props.children}
        </button>
    );
}
