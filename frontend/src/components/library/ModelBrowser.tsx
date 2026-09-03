import { useMemo, useState } from 'react';
import { CheckCircle2, Download, ImageOff, Trash2 } from 'lucide-react';
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
import { BrowserToolbar, EmptyState, FolderPane, MODEL_SORTS, StarButton } from './BrowserChrome';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ModelDetailSheet } from './ModelDetailSheet';
import { DownloadModelDialog } from './DownloadModelDialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PromptDialog } from '../ui/PromptDialog';
import { useContextMenu, type LongPressHandlers, type MenuAction } from '../ui/ContextMenu';
import { useIncremental } from '../ui/useIncremental';
import { useTranslation } from '@/i18n';

/** Stands in for a listing that has not arrived, with one identity rather than a fresh `[]` per
 *  render - everything downstream of it is memoized on the array. */
const EMPTY: (ModelCard | WildcardCard)[] = [];

/** One browser for every model-family asset plus wildcards. The Library destination picks the
 *  subtype; everything else about the screen is shared. */
export function ModelBrowser(props: { subtype: ModelSubtype; label: string; emptyHint?: string }) {
    const { t } = useTranslation();
    const [path, setPath] = useState('');
    const [search, setSearch] = useState('');
    const [view, setView] = useState<ViewMode>('grid');
    const [sort, setSort] = useState<SortMode>('Name');
    const [reverse, setReverse] = useState(false);
    const [selected, setSelected] = useState<ModelCard | WildcardCard | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingRename, setPendingRename] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
    const [downloading, setDownloading] = useState(false);

    const models = useModels(props.subtype, path, sort, reverse, 3);
    const userData = useMyUserData();
    const toggleStar = useToggleStar();
    const deleteModel = useDeleteModel();
    const renameModel = useRenameModel();
    const selectModel = useSelectModel();
    const contextMenu = useContextMenu();

    const canDelete = usePermission('delete_models');
    const canEdit = usePermission('edit_model_metadata');
    // Wildcards are written here rather than fetched from anywhere, so they get no downloader.
    const canDownload = usePermission('download_models') && props.subtype !== 'Wildcards';

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

    // A model root of several thousand files is ordinary; draw it as it is scrolled through.
    const shown = useIncremental(ordered);

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
            { label: t('modelBrowser.action.details'), onSelect: () => setSelected(file) },
            {
                label: starred.has(file.name) ? t('common.unstar') : t('common.star'),
                onSelect: () => toggleStar.mutate({ bucket: props.subtype, name: file.name })
            }
        ];
        if (isModelCard(file)) {
            actions.push({
                label: t('modelBrowser.action.loadOnBackends'),
                onSelect: () => selectModel.mutate({ name: file.name })
            });
        }
        if (canEdit) {
            actions.push({
                label: t('modelBrowser.action.rename'),
                separated: true,
                onSelect: () => setPendingRename(file.name)
            });
        }
        if (canDelete) {
            actions.push({
                label: t('modelBrowser.action.delete'),
                destructive: true,
                separated: !canEdit,
                onSelect: () => setPendingDelete(file.name)
            });
        }
        return actions;
    }

    return (
        // Column-first below `md`, where the folder pane is a collapsible bar rather than a rail.
        <div className="flex h-full min-h-0 flex-col md:flex-row">
            <FolderPane folders={models.data?.folders} path={path} onNavigate={setPath} />

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
                    count={ordered.length}
                    total={files.length}
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
                    ) : view === 'grid' ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                            {shown.visible.map(file => (
                                <Card
                                    key={file.name}
                                    file={file}
                                    starred={starred.has(file.name)}
                                    checked={selection.isSelected(file.name)}
                                    onCheck={() => selection.toggle(file.name)}
                                    onStar={() => toggleStar.mutate({ bucket: props.subtype, name: file.name })}
                                    onOpen={event => selection.click(event, file.name, () => setSelected(file))}
                                    onMenu={event => contextMenu.open(event, actionsFor(file))}
                                    longPress={contextMenu.touch(() => actionsFor(file))}
                                />
                            ))}
                        </div>
                    ) : (
                        <ul className="divide-y divide-[var(--light-border)]">
                            {shown.visible.map(file => (
                                <Row
                                    key={file.name}
                                    file={file}
                                    starred={starred.has(file.name)}
                                    checked={selection.isSelected(file.name)}
                                    onCheck={() => selection.toggle(file.name)}
                                    onStar={() => toggleStar.mutate({ bucket: props.subtype, name: file.name })}
                                    onOpen={event => selection.click(event, file.name, () => setSelected(file))}
                                    onMenu={event => contextMenu.open(event, actionsFor(file))}
                                    longPress={contextMenu.touch(() => actionsFor(file))}
                                />
                            ))}
                        </ul>
                    )}
                    {shown.endRef && <div ref={shown.endRef} className="h-4" aria-hidden />}
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
                title={t('modelBrowser.deleteTitle')}
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
                        deleteModel.mutate({ subtype: props.subtype, name: pendingDelete });
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
                    void deleteSelected();
                }}
                onCancel={() => setPendingBulkDelete(false)}
            />

            <PromptDialog
                open={pendingRename !== null}
                title={t('modelBrowser.renameTitle')}
                label={t('modelBrowser.renameLabel')}
                hint={t('modelBrowser.renameHint')}
                initialValue={pendingRename ?? ''}
                confirmLabel={t('modelBrowser.rename')}
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
    longPress: LongPressHandlers;
}) {
    const { t, tDynamic } = useTranslation();
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
                <div className="p-2">
                    <p className="truncate text-sm text-fg-strong">{card?.title || file.name.split('/').pop()}</p>
                    {card?.class && (
                        <p className="truncate text-xs text-fg-soft">{tDynamic(card.class)}</p>
                    )}
                </div>
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
    longPress: LongPressHandlers;
}) {
    const { t, tDynamic } = useTranslation();
    const card = isModelCard(props.file) ? props.file : null;
    const image = previewUrl(card ? card.preview_image : (props.file as WildcardCard).image);

    return (
        <li className="group flex items-center gap-3 py-1.5" onContextMenu={props.onMenu} {...props.longPress}>
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
        </li>
    );
}
