import { useMemo, useState } from 'react';
import { CheckCircle2, ImageOff, Trash2 } from 'lucide-react';
import {
    useDeleteModel,
    useModels,
    useMyUserData,
    useRenameModel,
    useSelectModel,
    useToggleStar
} from '@/library/hooks';
import {
    isModelCard,
    previewUrl,
    type ModelCard,
    type ModelSubtype,
    type SortMode,
    type ViewMode,
    type WildcardCard
} from '@/library/types';
import { usePermission } from '@/api/permissions';
import { BrowserToolbar, EmptyState, FolderPane, StarButton } from './BrowserChrome';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ModelDetailSheet } from './ModelDetailSheet';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PromptDialog } from '../ui/PromptDialog';
import { useContextMenu, type MenuAction } from '../ui/ContextMenu';

/** Unified browser for every model-family asset plus wildcards.
 *
 * Replaces seven separate cramped panes in the legacy bottom tab strip (Models, VAEs, LoRAs,
 * Embeddings, ControlNets, Wildcards, Presets), which shared vertical space with the image and so
 * defaulted to roughly 300px tall. */
export function ModelBrowser(props: { subtype: ModelSubtype; label: string; emptyHint?: string }) {
    const [path, setPath] = useState('');
    const [search, setSearch] = useState('');
    const [view, setView] = useState<ViewMode>('grid');
    const [sort, setSort] = useState<SortMode>('Name');
    const [reverse, setReverse] = useState(false);
    const [selected, setSelected] = useState<ModelCard | WildcardCard | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingRename, setPendingRename] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

    const models = useModels(props.subtype, path, sort, reverse, 3);
    const userData = useMyUserData();
    const toggleStar = useToggleStar();
    const deleteModel = useDeleteModel();
    const renameModel = useRenameModel();
    const selectModel = useSelectModel();
    const contextMenu = useContextMenu();

    const canDelete = usePermission('delete_models');
    const canEdit = usePermission('edit_model_metadata');

    const starred = userData.data?.starred_models?.[props.subtype] ?? [];

    const files = models.data?.files ?? [];
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return files;
        }
        return files.filter(file => {
            const title = isModelCard(file) ? (file.title ?? '') : '';
            const tags = isModelCard(file) ? (file.tags ?? []).join(' ') : '';
            return `${file.name} ${title} ${tags}`.toLowerCase().includes(query);
        });
    }, [files, search]);

    // Starred first, then the server's ordering.
    const ordered = useMemo(() => {
        const starSet = new Set(starred);
        return [...filtered].sort((a, b) => Number(starSet.has(b.name)) - Number(starSet.has(a.name)));
    }, [filtered, starred]);

    const ids = useMemo(() => ordered.map(file => file.name), [ordered]);
    const selection = useSelection(ids);

    /** Deletes every selected entry. One request per file - the API has no batch form. */
    async function deleteSelected(): Promise<void> {
        const targets = selection.ids;
        if (selected && targets.includes(selected.name)) {
            setSelected(null);
        }
        selection.clear();
        for (const name of targets) {
            await deleteModel.mutateAsync({ subtype: props.subtype, name });
        }
    }

    /** Everything one entry can do, for its right-click menu. */
    function actionsFor(file: ModelCard | WildcardCard): MenuAction[] {
        const actions: MenuAction[] = [
            { label: 'Details', onSelect: () => setSelected(file) },
            {
                label: starred.includes(file.name) ? 'Unstar' : 'Star',
                onSelect: () => toggleStar.mutate({ subtype: props.subtype, name: file.name })
            }
        ];
        if (isModelCard(file)) {
            actions.push({
                label: 'Load on backends',
                onSelect: () => selectModel.mutate({ name: file.name })
            });
        }
        if (canEdit) {
            actions.push({ label: 'Rename…', separated: true, onSelect: () => setPendingRename(file.name) });
        }
        if (canDelete) {
            actions.push({
                label: 'Delete…',
                destructive: true,
                separated: !canEdit,
                onSelect: () => setPendingDelete(file.name)
            });
        }
        return actions;
    }

    return (
        <div className="flex h-full min-h-0">
            <FolderPane folders={models.data?.folders} path={path} onNavigate={setPath} />

            <div className="flex min-w-0 flex-1 flex-col">
                <BrowserToolbar
                    search={search}
                    onSearch={setSearch}
                    view={view}
                    onView={setView}
                    sort={sort}
                    onSort={setSort}
                    reverse={reverse}
                    onReverse={setReverse}
                    count={ordered.length}
                    total={files.length}
                />

                {selection.count > 0 && (
                    <SelectionBar
                        count={selection.count}
                        total={ordered.length}
                        onSelectAll={selection.selectAll}
                        onClear={selection.clear}
                    >
                        {canDelete && (
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
                    {models.isPending ? (
                        <EmptyState title={`Loading ${props.label}…`} />
                    ) : models.isError ? (
                        <EmptyState
                            title={`Couldn't load ${props.label}.`}
                            hint={models.error instanceof Error ? models.error.message : undefined}
                        />
                    ) : ordered.length === 0 ? (
                        <EmptyState
                            title={
                                search
                                    ? `No ${props.label} match "${search.trim()}".`
                                    : `No ${props.label} found.`
                            }
                            hint={search ? undefined : props.emptyHint}
                        />
                    ) : view === 'grid' ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                            {ordered.map(file => (
                                <Card
                                    key={file.name}
                                    file={file}
                                    starred={starred.includes(file.name)}
                                    checked={selection.isSelected(file.name)}
                                    onCheck={() => selection.toggle(file.name)}
                                    onStar={() => toggleStar.mutate({ subtype: props.subtype, name: file.name })}
                                    onOpen={event => selection.click(event, file.name, () => setSelected(file))}
                                    onMenu={event => contextMenu.open(event, actionsFor(file))}
                                />
                            ))}
                        </div>
                    ) : (
                        <ul className="divide-y divide-[var(--light-border)]">
                            {ordered.map(file => (
                                <Row
                                    key={file.name}
                                    file={file}
                                    starred={starred.includes(file.name)}
                                    checked={selection.isSelected(file.name)}
                                    onCheck={() => selection.toggle(file.name)}
                                    onStar={() => toggleStar.mutate({ subtype: props.subtype, name: file.name })}
                                    onOpen={event => selection.click(event, file.name, () => setSelected(file))}
                                    onMenu={event => contextMenu.open(event, actionsFor(file))}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {selected && (
                <ModelDetailSheet
                    file={selected}
                    subtype={props.subtype}
                    canEdit={canEdit}
                    onClose={() => setSelected(null)}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Delete model?"
                body={
                    <>
                        <code className="font-mono text-fg">{pendingDelete}</code> will be deleted from
                        disk. Depending on server settings this may be permanent.
                    </>
                }
                confirmLabel="Delete"
                destructive
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteModel.mutate({ subtype: props.subtype, name: pendingDelete });
                    }
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />

            <ConfirmDialog
                open={pendingBulkDelete}
                title={`Delete ${selection.count} ${props.label}?`}
                body={
                    <>
                        All <strong className="text-fg">{selection.count}</strong> selected entries will
                        be deleted from disk. Depending on server settings this may be permanent.
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

            <PromptDialog
                open={pendingRename !== null}
                title="Rename model"
                label="New full path (folders are created as needed)"
                hint="This renames the file on disk, including its metadata sidecar."
                initialValue={pendingRename ?? ''}
                confirmLabel="Rename"
                onConfirm={newName => {
                    if (pendingRename) {
                        renameModel.mutate({ subtype: props.subtype, oldName: pendingRename, newName });
                    }
                    setPendingRename(null);
                }}
                onCancel={() => setPendingRename(null)}
            />

            {contextMenu.menu}
        </div>
    );
}

function Card(props: {
    file: ModelCard | WildcardCard;
    starred: boolean;
    checked: boolean;
    onCheck: () => void;
    onStar: () => void;
    onOpen: (event: React.MouseEvent) => void;
    onMenu: (event: React.MouseEvent) => void;
}) {
    const { file } = props;
    const card = isModelCard(file) ? file : null;
    const image = previewUrl(card ? card.preview_image : (file as WildcardCard).image);

    return (
        <div
            className={[
                'group relative overflow-hidden rounded-lg border bg-surface',
                props.checked ? 'border-[var(--emphasis)]' : 'border-default'
            ].join(' ')}
            onContextMenu={props.onMenu}
        >
            <button
                type="button"
                onClick={props.onOpen}
                className="block w-full text-left"
                title={`${file.name}\nRight-click for actions`}
            >
                <div className="flex aspect-square items-center justify-center bg-surface-sunken">
                    {image ? (
                        <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                        <ImageOff size={24} className="text-fg-soft opacity-40" aria-hidden />
                    )}
                </div>
                <div className="p-2">
                    <p className="truncate text-sm text-fg-strong">{card?.title || file.name.split('/').pop()}</p>
                    {card?.class && <p className="truncate text-xs text-fg-soft">{card.class}</p>}
                </div>
            </button>

            {/* One row so the checkbox fading in never lands on top of the loaded badge. */}
            <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                <SelectionCheckbox
                    overlay
                    checked={props.checked}
                    onToggle={props.onCheck}
                    label={`Select ${file.name}`}
                />
                {card?.loaded && (
                    <span
                        title="Loaded on a backend"
                        className="rounded-full bg-black/60 p-1"
                        style={{ color: 'var(--backend-running)' }}
                    >
                        <CheckCircle2 size={13} aria-hidden />
                    </span>
                )}
            </div>

            <div className="absolute right-1.5 top-1.5 flex gap-1">
                <StarButton starred={props.starred} variant="overlay" onClick={props.onStar} />
            </div>
        </div>
    );
}

function Row(props: {
    file: ModelCard | WildcardCard;
    starred: boolean;
    checked: boolean;
    onCheck: () => void;
    onStar: () => void;
    onOpen: (event: React.MouseEvent) => void;
    onMenu: (event: React.MouseEvent) => void;
}) {
    const card = isModelCard(props.file) ? props.file : null;
    const image = previewUrl(card ? card.preview_image : (props.file as WildcardCard).image);

    return (
        <li className="group flex items-center gap-3 py-1.5" onContextMenu={props.onMenu}>
            <SelectionCheckbox
                checked={props.checked}
                onToggle={props.onCheck}
                label={`Select ${props.file.name}`}
            />
            <StarButton starred={props.starred} variant="plain" onClick={props.onStar} />
            <button
                type="button"
                onClick={props.onOpen}
                title={`${props.file.name}\nRight-click for actions`}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
                <span className="size-8 shrink-0 overflow-hidden rounded bg-surface-sunken">
                    {image && <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{props.file.name}</span>
                {card?.class && <span className="shrink-0 text-xs text-fg-soft">{card.class}</span>}
                {card?.loaded && (
                    <span className="shrink-0 text-xs" style={{ color: 'var(--backend-running)' }}>
                        loaded
                    </span>
                )}
            </button>
        </li>
    );
}
