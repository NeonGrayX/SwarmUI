import { useMemo, useState } from 'react';
import { CheckCircle2, Download, ImageOff, Info, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    refreshModelLists,
    useDeleteModels,
    useModels,
    useMyUserData,
    useRenameModel,
    useSelectModel,
    useToggleStar
} from '@/library/hooks';
import {
    isModelCard,
    isPlaceholderImage,
    previewUrl,
    type BrowserFormat,
    type ModelCard,
    type ModelSubtype,
    type SortMode,
    type WildcardCard
} from '@/library/types';
import { historyKeyForSubtype, useBrowseHistory } from '@/library/browseHistory';
import { useLibraryAsset } from '@/library/useLibraryAsset';
import { useWorkspaceHandoffStore } from '@/generate/handoff';
import { usePermission } from '@/api/permissions';
import {
    BrowserToolbar,
    EmptyState,
    FolderPane,
    MODEL_SORTS,
    StarButton,
    formatGridClass,
    isThumbnailFormat,
    useBrowserFormat,
    useFlash
} from './BrowserChrome';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ModelDetailSheet } from './ModelDetailSheet';
import { WildcardEditorDialog, WildcardSheet, type WildcardEditTarget } from './WildcardSheet';
import { RenameDialog } from './RenameDialog';
import { DownloadModelDialog } from './DownloadModelDialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useContextMenu, type LongPressHandlers, type MenuAction } from '../ui/ContextMenu';
import { useIncremental } from '../ui/useIncremental';
import { useTranslation } from '@/i18n';

type Entry = ModelCard | WildcardCard;

/** Stands in for a listing that has not arrived, with one identity rather than a fresh `[]` per
 *  render - everything downstream of it is memoized on the array. */
const EMPTY: Entry[] = [];

/** One browser for every model-family asset plus wildcards. The Library destination picks the
 *  subtype; everything else about the screen is shared.
 *
 *  Clicking an entry uses it, as the legacy browsers do: a model becomes the model, a LoRA joins
 *  the LoRA list, an embedding or wildcard goes into the prompt. The details are one button (or the
 *  right-click menu) away. Subtypes the Generate form has no place for open their details instead. */
export function ModelBrowser(props: { subtype: ModelSubtype; label: string; emptyHint?: string }) {
    const { t } = useTranslation();
    const isWildcards = props.subtype === 'Wildcards';
    const [path, setPath] = useState('');
    const [search, setSearch] = useState('');
    const [view, setView] = useBrowserFormat(`models-${props.subtype}`);
    const [sort, setSort] = useState<SortMode>('Name');
    const [reverse, setReverse] = useState(false);
    // Legacy's model browsers open three levels deep; more is the user's call, since every level
    // is more of the library in one listing.
    const [depth, setDepth] = useState(3);
    const [selected, setSelected] = useState<Entry | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingRename, setPendingRename] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [editingWildcard, setEditingWildcard] = useState<WildcardEditTarget | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const models = useModels(props.subtype, path, sort, reverse, depth);
    const userData = useMyUserData();
    const toggleStar = useToggleStar();
    const deleteModels = useDeleteModels();
    const renameModel = useRenameModel();
    const selectModel = useSelectModel();
    const contextMenu = useContextMenu();
    const browseHistory = useBrowseHistory();
    const historyKey = historyKeyForSubtype(props.subtype);
    const asset = useLibraryAsset(props.subtype);
    const flash = useFlash();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const handOver = useWorkspaceHandoffStore(s => s.openWorkspace);

    const canEditWildcards = usePermission('edit_wildcards');
    const canDeleteModels = usePermission('delete_models');
    const canEditMetadata = usePermission('edit_model_metadata');
    // Wildcards have routes of their own, behind one permission; RenameModel sits behind the delete
    // permission server-side (ModelsAPI.cs), not the metadata one.
    const canDelete = isWildcards ? canEditWildcards : canDeleteModels;
    const canRename = canDelete;
    const canEdit = canEditMetadata && !isWildcards;
    const canLoad = usePermission('load_models_now');
    // Wildcards are written here rather than fetched from anywhere, so they get no downloader.
    const canDownload = usePermission('download_models') && !isWildcards;

    // A set rather than the raw list, and memoized: `includes` per card is quadratic over a
    // library of a few thousand models, and the `?? []` fallback would otherwise be a fresh array
    // on every render, re-running the sort below with it.
    const starredNames = userData.data?.starred_models?.[props.subtype];
    const starred = useMemo(() => new Set(starredNames ?? []), [starredNames]);

    const files = models.data?.files ?? EMPTY;
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
    const ordered = useMemo(
        () => [...filtered].sort((a, b) => Number(starred.has(b.name)) - Number(starred.has(a.name))),
        [filtered, starred]
    );

    // A model root of several thousand files is ordinary; draw it as it is scrolled through. Only a
    // different listing starts over from the top - a star or a delete leaves the scroll alone.
    const shown = useIncremental(ordered, 120, `${path}\n${search}\n${sort}\n${reverse}\n${depth}`);

    const ids = useMemo(() => ordered.map(file => file.name), [ordered]);
    const selection = useSelection(ids);

    // The sheet follows the live entry while it is listed, so a save or a refresh shows there; once
    // it is not (another folder, a search), the copy taken at click time is all there is.
    const detail = useMemo(
        () => (selected ? (files.find(file => file.name === selected.name) ?? selected) : null),
        [selected, files]
    );

    function star(name: string): void {
        toggleStar.mutate(
            { bucket: props.subtype, name },
            { onError: error => flash.error(error, t('library.starFailed')) }
        );
    }

    /** Puts an entry to use on the Generate form, and says so with a way there. */
    function use(file: Entry): void {
        const message = asset.use(file);
        if (message) {
            flash.show(message, {
                action: {
                    label: t('library.openGenerate'),
                    onClick: () => {
                        handOver('standard');
                        void navigate({ to: '/generate' });
                    }
                }
            });
        }
    }

    /** What a plain click does: use the entry where it has a use, open its details otherwise. */
    function open(file: Entry): void {
        if (asset.label(file)) {
            use(file);
        }
        else {
            setSelected(file);
        }
    }

    function deleteNames(names: string[]): void {
        if (selected && names.includes(selected.name)) {
            setSelected(null);
        }
        deleteModels.mutate(
            { subtype: props.subtype, names },
            { onError: error => flash.error(error, t('modelBrowser.deleteFailed')) }
        );
    }

    /** Deletes every selected entry. */
    function deleteSelected(): void {
        const targets = selection.ids;
        selection.clear();
        deleteNames(targets);
    }

    function rename(oldName: string, newName: string): void {
        renameModel.mutate(
            { subtype: props.subtype, oldName, newName },
            {
                onSuccess: () => setSelected(current => (current?.name === oldName ? null : current)),
                onError: error => flash.error(error, t('modelBrowser.renameFailed'))
            }
        );
    }

    async function refresh(): Promise<void> {
        setRefreshing(true);
        try {
            await refreshModelLists(queryClient);
        }
        catch (error: unknown) {
            flash.error(error, t('browser.refreshFailed'));
        }
        finally {
            setRefreshing(false);
        }
    }

    /** Everything one entry can do, for its right-click menu. */
    function actionsFor(file: Entry): MenuAction[] {
        const actions: MenuAction[] = [];
        const useLabel = asset.label(file);
        if (useLabel) {
            actions.push({ label: useLabel, onSelect: () => use(file) });
        }
        actions.push(
            { label: t('modelBrowser.action.details'), onSelect: () => setSelected(file) },
            {
                label: starred.has(file.name) ? t('common.unstar') : t('common.star'),
                onSelect: () => star(file.name)
            }
        );
        if (isModelCard(file) && props.subtype === 'Stable-Diffusion' && canLoad) {
            actions.push({
                label: t('modelBrowser.action.loadOnBackends'),
                onSelect: () =>
                    selectModel.mutate(
                        { name: file.name },
                        {
                            onSuccess: () => flash.show(t('modelBrowser.loadedOnBackends', { name: file.name })),
                            onError: error => flash.error(error, t('modelBrowser.loadFailedOnBackends'))
                        }
                    )
            });
        }
        if (historyKey) {
            actions.push({
                label: t('library.browseHistory'),
                onSelect: () => browseHistory(historyKey, file.name)
            });
        }
        if (isWildcards && canEditWildcards) {
            actions.push({
                label: t('wildcard.edit'),
                separated: true,
                onSelect: () => setEditingWildcard({ kind: 'edit', name: file.name })
            });
        }
        if (canRename) {
            actions.push({
                label: t('modelBrowser.action.rename'),
                separated: !(isWildcards && canEditWildcards),
                onSelect: () => setPendingRename(file.name)
            });
        }
        if (canDelete) {
            actions.push({
                label: t('modelBrowser.action.delete'),
                destructive: true,
                onSelect: () => setPendingDelete(file.name)
            });
        }
        return actions;
    }

    /** Props every entry shares, whatever format draws it. */
    function entryProps(file: Entry) {
        return {
            file,
            starred: starred.has(file.name),
            inUse: asset.inUse(file),
            checked: selection.isSelected(file.name),
            onCheck: () => selection.toggle(file.name),
            onStar: () => star(file.name),
            onOpen: (event: React.MouseEvent) => selection.click(event, file.name, () => open(file)),
            onDetails: () => setSelected(file),
            onMenu: (event: React.MouseEvent) => contextMenu.open(event, actionsFor(file)),
            longPress: contextMenu.touch(() => actionsFor(file))
        };
    }

    const detailUseLabel = detail ? asset.label(detail) : null;
    const detailUse = detail && detailUseLabel ? { label: detailUseLabel, onUse: () => use(detail) } : undefined;

    return (
        // Column-first below `md`, where the folder pane is a collapsible bar rather than a rail.
        <div className="relative flex h-full min-h-0 flex-col md:flex-row">
            <FolderPane folders={models.data?.folders} path={path} depth={depth} onNavigate={setPath} />

            <div className="flex min-w-0 flex-1 flex-col">
                <BrowserToolbar
                    search={search}
                    onSearch={setSearch}
                    view={view}
                    onView={setView}
                    sort={sort}
                    onSort={setSort}
                    sortOptions={MODEL_SORTS}
                    reverse={reverse}
                    onReverse={setReverse}
                    depth={depth}
                    onDepth={setDepth}
                    count={ordered.length}
                    total={files.length}
                    onRefresh={() => void refresh()}
                    refreshing={refreshing}
                >
                    {canDownload && (
                        <button
                            type="button"
                            onClick={() => setDownloading(true)}
                            title={t('modelBrowser.downloadHint', { noun: props.label })}
                            className="flex items-center gap-1 rounded border border-default px-2 py-1 text-xs text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <Download size={13} aria-hidden />
                            {t('common.download')}
                        </button>
                    )}
                    {isWildcards && canEditWildcards && (
                        <button
                            type="button"
                            onClick={() => setEditingWildcard({ kind: 'new', folder: path })}
                            className="flex items-center gap-1 rounded border border-default px-2 py-1 text-xs text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <Plus size={13} aria-hidden />
                            {t('wildcard.create')}
                        </button>
                    )}
                </BrowserToolbar>

                {selection.count > 0 && (
                    <SelectionBar
                        count={selection.count}
                        total={ordered.length}
                        onSelectAll={selection.selectAll}
                        onClear={selection.clear}
                    >
                        {canDelete && (
                            <SelectionButton
                                label={t('common.delete')}
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
                        <EmptyState title={t('modelBrowser.loading', { noun: props.label })} />
                    ) : models.isError ? (
                        <EmptyState
                            title={t('modelBrowser.loadFailed', { noun: props.label })}
                            hint={models.error instanceof Error ? models.error.message : undefined}
                        />
                    ) : ordered.length === 0 ? (
                        <EmptyState
                            title={
                                search
                                    ? t('modelBrowser.noSearchMatches', {
                                          noun: props.label,
                                          search: search.trim()
                                      })
                                    : t('modelBrowser.noneFound', { noun: props.label })
                            }
                            hint={search ? undefined : props.emptyHint}
                        />
                    ) : view === 'list' ? (
                        <ul className="divide-y divide-[var(--light-border)]">
                            {shown.visible.map(file => (
                                <Row key={file.name} {...entryProps(file)} />
                            ))}
                        </ul>
                    ) : (
                        <div className={formatGridClass(view)}>
                            {shown.visible.map(file => (
                                <Card key={file.name} format={view} {...entryProps(file)} />
                            ))}
                        </div>
                    )}
                    {shown.endRef && <div ref={shown.endRef} className="h-4" aria-hidden />}
                </div>
            </div>

            {detail && isModelCard(detail) && (
                <ModelDetailSheet
                    file={detail}
                    subtype={props.subtype}
                    canEdit={canEdit}
                    use={detailUse}
                    onClose={() => setSelected(null)}
                />
            )}

            {detail && !isModelCard(detail) && (
                <WildcardSheet
                    card={detail}
                    canEdit={canEditWildcards}
                    use={detailUse}
                    onEdit={() => setEditingWildcard({ kind: 'edit', name: detail.name })}
                    onDelete={() => setPendingDelete(detail.name)}
                    onClose={() => setSelected(null)}
                />
            )}

            {isWildcards && (
                <WildcardEditorDialog
                    target={editingWildcard}
                    onClose={() => setEditingWildcard(null)}
                    onSaved={name => {
                        const previous = editingWildcard?.kind === 'edit' ? editingWildcard.name : null;
                        setEditingWildcard(null);
                        // A save under a new name moved it; the sheet would otherwise hold on to the
                        // old one, which no longer exists.
                        if (previous !== null && previous !== name) {
                            setSelected(current => (current?.name === previous ? null : current));
                        }
                    }}
                />
            )}

            {canDownload && (
                <DownloadModelDialog
                    open={downloading}
                    subtype={props.subtype}
                    folder={path}
                    onClose={() => setDownloading(false)}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={isWildcards ? t('wildcard.deleteTitle') : t('modelBrowser.deleteTitle')}
                body={
                    <>
                        <code className="font-mono text-fg">{pendingDelete}</code>{' '}
                        {t('modelBrowser.deleteBody')}
                    </>
                }
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteNames([pendingDelete]);
                    }
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />

            <ConfirmDialog
                open={pendingBulkDelete}
                title={t('modelBrowser.bulkDeleteTitle', {
                    count: selection.count,
                    noun: props.label
                })}
                body={t('modelBrowser.bulkDeleteBody', { count: selection.count })}
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    setPendingBulkDelete(false);
                    deleteSelected();
                }}
                onCancel={() => setPendingBulkDelete(false)}
            />

            <RenameDialog
                target={pendingRename}
                subtype={props.subtype}
                title={isWildcards ? t('wildcard.renameTitle') : t('modelBrowser.renameTitle')}
                hint={isWildcards ? undefined : t('modelBrowser.renameHint')}
                onConfirm={newName => {
                    if (pendingRename) {
                        rename(pendingRename, newName);
                    }
                    setPendingRename(null);
                }}
                onCancel={() => setPendingRename(null)}
            />

            {flash.node}
            {contextMenu.menu}
        </div>
    );
}

interface EntryProps {
    file: Entry;
    starred: boolean;
    /** The Generate form is currently using this entry. */
    inUse: boolean;
    checked: boolean;
    onCheck: () => void;
    onStar: () => void;
    onOpen: (event: React.MouseEvent) => void;
    onDetails: () => void;
    onMenu: (event: React.MouseEvent) => void;
    longPress: LongPressHandlers;
}

function entryImage(file: Entry): string | undefined {
    const raw = isModelCard(file) ? file.preview_image : file.image;
    return isPlaceholderImage(raw) ? undefined : previewUrl(raw);
}

/** Overlay button that opens an entry's details, since a click on the entry uses it. */
function DetailsButton(props: { name: string; onClick: () => void; overlay: boolean }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={t('library.detailsFor', { name: props.name })}
            title={t('modelBrowser.action.details')}
            className={
                props.overlay
                    ? 'rounded-full bg-black/60 p-1 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
                    : 'shrink-0 rounded-full p-1 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
            }
        >
            <Info size={props.overlay ? 13 : 14} aria-hidden />
        </button>
    );
}

function Card(props: EntryProps & { format: Exclude<BrowserFormat, 'list'> }) {
    const { t, tDynamic } = useTranslation();
    const { file } = props;
    const card = isModelCard(file) ? file : null;
    const image = entryImage(file);
    const thumbnail = isThumbnailFormat(props.format);
    const name = card?.title || file.name.split('/').pop();

    return (
        <div
            className={[
                'group relative overflow-hidden rounded-lg border bg-surface',
                props.checked || props.inUse ? 'border-[var(--emphasis)]' : 'border-default',
                props.inUse ? 'ring-1 ring-[var(--emphasis)]' : ''
            ].join(' ')}
            onContextMenu={props.onMenu}
            {...props.longPress}
        >
            <button
                type="button"
                onClick={props.onOpen}
                className="block w-full text-left"
                title={`${file.name}\n${t('browser.rightClickForActions')}`}
            >
                <div className="flex aspect-square items-center justify-center bg-surface-sunken">
                    {image ? (
                        <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                        <ImageOff size={24} className="text-fg-soft opacity-40" aria-hidden />
                    )}
                </div>
                {thumbnail ? (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {name}
                    </span>
                ) : (
                    <div className={props.format === 'smallCards' ? 'p-1.5' : 'p-2'}>
                        <p className={['truncate text-fg-strong', props.format === 'smallCards' ? 'text-xs' : 'text-sm'].join(' ')}>
                            {name}
                        </p>
                        {card?.class && (
                            <p className="truncate text-xs text-fg-soft">{tDynamic(card.class)}</p>
                        )}
                        {props.format === 'bigCards' && card?.description && (
                            <p className="mt-1 line-clamp-3 text-xs text-fg-soft">{card.description}</p>
                        )}
                    </div>
                )}
            </button>

            {/* One row so the checkbox fading in never lands on top of the loaded badge. */}
            <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                <SelectionCheckbox
                    overlay
                    checked={props.checked}
                    onToggle={props.onCheck}
                    label={t('browser.selectEntry', { name: file.name })}
                />
                {card?.loaded && (
                    <span
                        title={t('modelPicker.loadedOnBackend')}
                        className="rounded-full bg-black/60 p-1"
                        style={{ color: 'var(--backend-running)' }}
                    >
                        <CheckCircle2 size={13} aria-hidden />
                    </span>
                )}
            </div>

            <div className="absolute right-1.5 top-1.5 flex gap-1">
                <DetailsButton name={file.name} onClick={props.onDetails} overlay />
                <StarButton starred={props.starred} variant="overlay" onClick={props.onStar} />
            </div>
        </div>
    );
}

function Row(props: EntryProps) {
    const { t, tDynamic } = useTranslation();
    const card = isModelCard(props.file) ? props.file : null;
    const image = entryImage(props.file);

    return (
        <li
            className={['group flex items-center gap-3 py-1.5', props.inUse ? 'bg-[var(--sw-active)]' : ''].join(' ')}
            onContextMenu={props.onMenu}
            {...props.longPress}
        >
            <SelectionCheckbox
                checked={props.checked}
                onToggle={props.onCheck}
                label={t('browser.selectEntry', { name: props.file.name })}
            />
            <StarButton starred={props.starred} variant="plain" onClick={props.onStar} />
            <button
                type="button"
                onClick={props.onOpen}
                title={`${props.file.name}\n${t('browser.rightClickForActions')}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
                <span className="size-8 shrink-0 overflow-hidden rounded bg-surface-sunken">
                    {image && <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{props.file.name}</span>
                {card?.class && (
                    <span className="shrink-0 text-xs text-fg-soft">{tDynamic(card.class)}</span>
                )}
                {card?.loaded && (
                    <span className="shrink-0 text-xs" style={{ color: 'var(--backend-running)' }}>
                        {t('modelBrowser.loaded')}
                    </span>
                )}
            </button>
            <DetailsButton name={props.file.name} onClick={props.onDetails} overlay={false} />
        </li>
    );
}
