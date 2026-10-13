import { useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, Loader2, Star, Trash2, X } from 'lucide-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useDeleteImage, useImages, useToggleImageStar } from '@/library/hooks';
import {
    imageOutPrefix,
    imageSearchText,
    isEntryStarred,
    type ImageEntry,
    type ImageSortMode
} from '@/library/types';
import { usePermission } from '@/api/permissions';
import { useSession } from '@/api/hooks';
import { useReuseParameters } from '@/params/reuse';
import { useMediaParamAction } from '@/params/useMediaParamAction';
import { useUserSetting } from '@/settings/useUserSetting';
import {
    BrowserToolbar,
    EmptyState,
    FolderPane,
    IMAGE_SORTS,
    StarButton,
    formatGridClass,
    isThumbnailFormat,
    useBrowserFormat,
    useFlash
} from './BrowserChrome';
import { DetailSheet } from '../ui/DetailSheet';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ImageLightbox } from '../ui/ImageLightbox';
import { OutputPlayer, OutputThumbnail, outputKind, useProgressiveOutput } from '../ui/OutputMedia';
import { useVideoEditor } from '../video/useVideoEditor';
import { MetadataView } from '../ui/MetadataView';
import { useContextMenu, type MenuAction } from '../ui/ContextMenu';
import { useIncremental } from '../ui/useIncremental';
import { useTranslation } from '@/i18n';

/** One image, pinned to the folder it was listed in.
 *
 * `src` only means anything relative to the folder it came back from, so anything that outlives
 * the current folder - the detail sheet, a pending delete - has to carry the joined path with it
 * rather than re-deriving it from wherever the browser has since navigated. */
interface PinnedImage {
    entry: ImageEntry;
    /** Path relative to the output root: what the star and delete calls take. */
    full: string;
    starred: boolean;
}

/** Stands in for a listing that has not arrived, with one identity rather than a fresh `[]` per
 *  render - everything derived from it below is memoized on the array. */
const EMPTY: ImageEntry[] = [];

/** Joins the browsed folder with a path-relative src from ListImages. */
function joinPath(folder: string, src: string): string {
    return folder ? `${folder}/${src}` : src;
}

/** A path as a URL path: every segment percent-encoded, so a `#`, `?` or `%` in a file or folder
 *  name reaches the server as part of the name rather than ending the path. */
function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
}

/** Saves an image to disk. The view route is same-origin, so `download` is honored and the tab
 *  stays where it is rather than navigating to the image. */
function downloadImage(url: string, src: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = src.slice(src.lastIndexOf('/') + 1);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/** Browsers drop downloads fired in one burst, so a bulk save has to pace itself. */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Output history browser.
 *
 * ListImages returns `src` paths relative to the *user's* output directory, so they need the
 * user-aware prefix from imageOutPrefix - `/View/<user_id>/...` or `/Output/...` depending on the
 * server's AppendUserNameToOutputPath setting. A bare `/View/<src>` 404s. The generation websocket
 * differs: it already sends fully-prefixed paths. */
export function HistoryBrowser() {
    const { t } = useTranslation();
    // ?search= arrives from a "Browse history" action elsewhere in the Library, eg `model: sdxl`.
    const routeSearch = useSearch({ strict: false }) as { search?: string };
    const [path, setPath] = useState('');
    const [search, setSearch] = useState(routeSearch.search ?? '');
    const [view, setView] = useBrowserFormat('history');
    // Date sort, unreversed: the server's date order is the default the history screen opens with,
    // and reversing it is left to the user's toggle.
    const [sort, setSort] = useState<ImageSortMode>('Date');
    const [reverse, setReverse] = useState(false);
    // Subfolders are per-model or per-day, so a couple of levels of them is the usual shape of an
    // output folder; deeper is available but is the user's call, since the server walks every level.
    const [depth, setDepth] = useState(3);
    const [selected, setSelected] = useState<PinnedImage | null>(null);
    const [viewing, setViewing] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

    const flash = useFlash();

    const images = useImages(path, sort, reverse, depth);
    // The listing stops at MaxImagesInHistory, so a search of it alone can miss older images. Once
    // typing settles, the server is asked to search further itself (legacy's
    // scheduleImageHistoryServerFilter), unless the user's ImageHistoryServerFilter setting is off.
    const query = search.trim();
    const serverSearchOn = useUserSetting<boolean>('imagehistoryserverfilter', true) === true;
    const [serverQuery, setServerQuery] = useState('');
    useEffect(() => {
        if (!serverSearchOn || !query) {
            setServerQuery('');
            return;
        }
        const timer = setTimeout(() => setServerQuery(query), 500);
        return () => clearTimeout(timer);
    }, [query, serverSearchOn]);
    const deepSearch = useImages(path, sort, reverse, depth, serverQuery, serverQuery !== '');
    // Only an answer to what is typed right now is used; while the next one is pending, the
    // listing on hand is searched instead.
    const deepResult = serverQuery === query ? deepSearch.data : undefined;
    const deepSearching = serverSearchOn && query !== '' && (serverQuery !== query || deepSearch.isFetching);
    const toggleStar = useToggleImageStar();
    const deleteImage = useDeleteImage();
    const canDelete = usePermission('user_delete_image');
    // Only does anything for a browser on the server's own machine; the server opens the folder there.
    const canOpenFolder = usePermission('local_image_folder');
    const queryClient = useQueryClient();
    const session = useSession();
    const navigate = useNavigate();
    const reuseParameters = useReuseParameters();
    const mediaParam = useMediaParamAction();
    const contextMenu = useContextMenu();
    const videoEditor = useVideoEditor();
    const prefix = imageOutPrefix(session.data?.user_id, session.data?.output_append_user);
    const urlForPath = (full: string) => `/${encodePath(prefix)}/${encodePath(full)}`;
    // ListImages returns `src` relative to the *requested path*, not to the output root, so the
    // current folder has to be joined back on. At root that is a no-op.
    const urlFor = (src: string) => urlForPath(joinPath(path, src));

    const files = (deepResult ?? images.data)?.files ?? EMPTY;
    // Every entry carries its whole generation metadata as a JSON string, and all the listing
    // wants from it is the star. Parsed once per listing here rather than once per card per
    // render, which on a folder of a few thousand images was megabytes of JSON per keystroke.
    // Each entry is parsed at most once (isEntryStarred caches per entry), so a listing that
    // changes by one starred or deleted image does not re-read all the others.
    const starredSrcs = useMemo(
        () => new Set(files.filter(isEntryStarred).map(file => file.src)),
        [files]
    );
    // Built only while searching: it means parsing every entry's metadata, once per entry.
    const searching = query !== '';
    const searchIndex = useMemo(
        () => (searching ? new Map(files.map(file => [file.src, imageSearchText(file)])) : null),
        [files, searching]
    );
    const filtered = useMemo(() => {
        const needle = query.toLowerCase();
        return searchIndex ? files.filter(file => searchIndex.get(file.src)?.includes(needle)) : files;
    }, [files, searchIndex, query]);

    // An output folder is routinely thousands of images; draw it as it is scrolled through. Only
    // another listing starts over from the top - a star or a delete leaves the scroll alone.
    const shown = useIncremental(filtered, 120, `${path}\n${query}\n${sort}\n${reverse}\n${depth}`);

    // Keyed by the path from the output root, not the folder-relative `src`: the same `src` in
    // another folder is another image, and must not inherit this one's checkbox.
    const ids = useMemo(() => filtered.map(file => joinPath(path, file.src)), [filtered, path]);
    const selection = useSelection(ids);

    // The sheet shows the image that was last clicked, whatever folder the tree has moved on to
    // since. While that image is still listed the live entry wins, so a star or a metadata refresh
    // shows up there too; once it isn't, the snapshot taken at click time is all there is.
    const detail = useMemo(() => {
        if (!selected) {
            return null;
        }
        const fresh = files.find(file => joinPath(path, file.src) === selected.full);
        return fresh
            ? { ...selected, entry: fresh, starred: isEntryStarred(fresh) }
            : selected;
    }, [selected, files, path]);

    // Where the shown image sits in the listing, which is what the viewer steps along. An image
    // pinned from a folder the tree has since left is not in it at all, so it is shown alone.
    const viewIndex = useMemo(
        () => (detail ? filtered.findIndex(file => joinPath(path, file.src) === detail.full) : -1),
        [detail, filtered, path]
    );

    // The viewer only ever shows the detail image, so it goes wherever that does - closed, deleted,
    // or cleared by a bulk delete.
    useEffect(() => {
        if (!selected) {
            setViewing(false);
        }
    }, [selected]);


    /** Pairs an entry with the folder it was listed in, for anything that outlives the listing. */
    function pin(entry: ImageEntry): PinnedImage {
        return {
            entry,
            full: joinPath(path, entry.src),
            starred: isEntryStarred(entry)
        };
    }

    /** Stars or unstars one image. The refreshed list answers for anything still on screen; the
     *  pinned sheet has to be told directly, since it may be showing another folder's image. */
    function star(full: string): void {
        toggleStar.mutate({ path: full }, {
            onSuccess: () => setSelected(current =>
                current && current.full === full ? { ...current, starred: !current.starred } : current),
            onError: error => flash.error(error, t('library.starFailed'))
        });
    }

    /** Moves the detail sheet, and with it the viewer, to a neighbouring image in the listing. */
    function step(delta: number): void {
        const next = viewIndex < 0 ? undefined : filtered[viewIndex + delta];
        if (next) {
            setSelected(pin(next));
        }
    }

    /** Loads an image's parameters into the generation form and switches to it. */
    function reuse(entry: ImageEntry): void {
        try {
            reuseParameters(entry.metadata);
            navigate({ to: '/generate' });
        }
        catch (error: unknown) {
            flash.error(error, t('history.reuseFailed'));
        }
    }

    /** Same, plus the image itself as the init image, for generating a variation of it. */
    async function useAsInit(image: PinnedImage): Promise<void> {
        try {
            reuseParameters(image.entry.metadata);
        }
        catch {
            // An image with no readable parameters is still perfectly good as an init image, and
            // the Generate screen shows plainly that only the image came across.
        }
        try {
            await mediaParam.set('initimage', urlForPath(image.full));
        }
        catch (error: unknown) {
            flash.error(error, t('history.initImageFailed'));
            return;
        }
        navigate({ to: '/generate' });
    }

    /** Saves every selected image, oldest-listed first. */
    async function downloadSelected(): Promise<void> {
        for (const full of selection.ids) {
            downloadImage(urlForPath(full), full);
            await delay(200);
        }
    }

    /** Has the server open the folder holding an image, in its own file manager. */
    async function openFolder(full: string): Promise<void> {
        try {
            await api.post('OpenImageFolder', { path: full });
        }
        catch (error: unknown) {
            flash.error(error, t('history.openFolderFailed'));
        }
    }

    function deleteOne(full: string): void {
        deleteImage.mutate({ path: full }, { onError: error => flash.error(error, t('history.deleteFailed')) });
        // Only the sheet showing *that* image closes; another one stays put.
        setSelected(current => (current?.full === full ? null : current));
    }

    /** Deletes every selected image. One request per file - the API has no batch form - so a
     *  failure part-way leaves the earlier deletions done, which the refreshed list shows. */
    async function deleteSelected(): Promise<void> {
        const targets = selection.ids;
        if (selected && targets.includes(selected.full)) {
            setSelected(null);
        }
        selection.clear();
        try {
            for (const full of targets) {
                await deleteImage.mutateAsync({ path: full });
            }
        }
        catch (error: unknown) {
            flash.error(error, t('history.bulkDeleteFailed'));
        }
    }

    /** Everything one image can do, for its right-click menu. */
    function actionsFor(entry: ImageEntry): MenuAction[] {
        const image = pin(entry);
        const actions: MenuAction[] = [
            { label: t('modelBrowser.action.details'), onSelect: () => setSelected(image) },
            {
                label: image.starred ? t('common.unstar') : t('common.star'),
                onSelect: () => star(image.full)
            },
            { label: t('common.download'), onSelect: () => downloadImage(urlFor(entry.src), entry.src) }
        ];
        if (canOpenFolder) {
            actions.push({ label: t('history.openFolder'), onSelect: () => void openFolder(image.full) });
        }
        actions.push({ label: t('history.reuseParameters'), separated: true, onSelect: () => reuse(entry) });
        if (mediaParam.available('initimage')) {
            actions.push({ label: t('history.useAsInit'), onSelect: () => void useAsInit(image) });
        }
        if (videoEditor.available && outputKind(entry.src) === 'video') {
            actions.push({
                label: t('videoEditor.open'),
                onSelect: () => videoEditor.edit(urlForPath(image.full), image.full)
            });
        }
        if (canDelete) {
            actions.push({
                label: t('modelBrowser.action.delete'),
                destructive: true,
                separated: true,
                onSelect: () => setPendingDelete(image.full)
            });
        }
        return actions;
    }

    return (
        <div className="relative flex h-full min-h-0 flex-col md:flex-row">
            <FolderPane folders={images.data?.folders} path={path} depth={depth} onNavigate={setPath} />

            <div className="flex min-w-0 flex-1 flex-col">
                <BrowserToolbar
                    search={search}
                    onSearch={setSearch}
                    view={view}
                    onView={setView}
                    sort={sort}
                    onSort={setSort}
                    sortOptions={IMAGE_SORTS}
                    reverse={reverse}
                    onReverse={setReverse}
                    depth={depth}
                    onDepth={setDepth}
                    count={filtered.length}
                    total={files.length}
                    onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['images'] })}
                    refreshing={images.isFetching}
                >
                    {deepSearching && (
                        <span className="flex items-center gap-1 text-xs text-fg-soft">
                            <Loader2 size={12} className="animate-spin" aria-hidden />
                            {t('history.deepSearching')}
                        </span>
                    )}
                </BrowserToolbar>

                {selection.count > 0 && (
                    <SelectionBar
                        count={selection.count}
                        total={filtered.length}
                        onSelectAll={selection.selectAll}
                        onClear={selection.clear}
                    >
                        <SelectionButton label={t('common.download')} onClick={() => void downloadSelected()}>
                            <Download size={13} aria-hidden />
                        </SelectionButton>
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
                    {images.isPending ? (
                        <EmptyState title={t('history.loading')} />
                    ) : images.isError ? (
                        <EmptyState
                            title={t('history.loadFailed')}
                            hint={images.error instanceof Error ? images.error.message : undefined}
                        />
                    ) : filtered.length === 0 ? (
                        <EmptyState
                            title={
                                deepSearching
                                    ? t('history.deepSearching')
                                    : searching
                                      ? t('history.noSearchMatches', { search: query })
                                      : t('history.noImages')
                            }
                            hint={searching ? undefined : t('history.noImagesHint')}
                        />
                    ) : view !== 'list' ? (
                        <div className={formatGridClass(view)}>
                            {shown.visible.map(file => {
                                const full = joinPath(path, file.src);
                                return (
                                    <div
                                        key={file.src}
                                        onContextMenu={event => contextMenu.open(event, actionsFor(file))}
                                        {...contextMenu.touch(() => actionsFor(file))}
                                        className={[
                                            'group relative aspect-square overflow-hidden rounded border bg-surface-sunken',
                                            selection.isSelected(full)
                                                ? 'border-[var(--emphasis)]'
                                                : 'border-default'
                                        ].join(' ')}
                                    >
                                        <button
                                            type="button"
                                            onClick={event => selection.click(event, full, () => setSelected(pin(file)))}
                                            title={`${file.src}\n${t('browser.rightClickForActions')}`}
                                            className="block h-full w-full"
                                        >
                                            <OutputThumbnail
                                                src={urlFor(file.src)}
                                                alt={file.src}
                                                className="h-full w-full object-cover"
                                            />
                                            <span
                                                className={[
                                                    'absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-left text-[10px] text-white',
                                                    // Card formats keep the name on screen; thumbnails show it on hover.
                                                    isThumbnailFormat(view) ? 'opacity-0 transition-opacity group-hover:opacity-100' : ''
                                                ].join(' ')}
                                            >
                                                {file.src.split('/').pop()}
                                            </span>
                                        </button>
                                        <span className="absolute left-1.5 top-1.5">
                                            <SelectionCheckbox
                                                overlay
                                                checked={selection.isSelected(full)}
                                                onToggle={() => selection.toggle(full)}
                                                label={t('browser.selectEntry', { name: file.src })}
                                            />
                                        </span>
                                        <span className="absolute right-1.5 top-1.5">
                                            <StarButton
                                                starred={starredSrcs.has(file.src)}
                                                variant="overlay"
                                                onClick={() => star(full)}
                                            />
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <ul className="divide-y divide-[var(--light-border)]">
                            {shown.visible.map(file => (
                                <li
                                    key={file.src}
                                    onContextMenu={event => contextMenu.open(event, actionsFor(file))}
                                    {...contextMenu.touch(() => actionsFor(file))}
                                    className="group flex items-center gap-3"
                                >
                                    <SelectionCheckbox
                                        checked={selection.isSelected(joinPath(path, file.src))}
                                        onToggle={() => selection.toggle(joinPath(path, file.src))}
                                        label={t('browser.selectEntry', { name: file.src })}
                                    />
                                    <StarButton
                                        starred={starredSrcs.has(file.src)}
                                        variant="plain"
                                        onClick={() => star(joinPath(path, file.src))}
                                    />
                                    <button
                                        type="button"
                                        onClick={event =>
                                            selection.click(event, joinPath(path, file.src), () => setSelected(pin(file)))
                                        }
                                        title={`${file.src}\n${t('browser.rightClickForActions')}`}
                                        className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
                                    >
                                        <span className="size-9 shrink-0 overflow-hidden rounded bg-surface-sunken">
                                            <OutputThumbnail
                                                src={urlFor(file.src)}
                                                alt={file.src}
                                                className="h-full w-full object-cover"
                                            />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{file.src}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {shown.endRef && <div ref={shown.endRef} className="h-4" aria-hidden />}
                </div>
            </div>

            {detail && (
                <ImageSheet
                    entry={detail.entry}
                    url={urlForPath(detail.full)}
                    starred={detail.starred}
                    canDelete={canDelete}
                    canUseAsInit={mediaParam.available('initimage')}
                    onEditVideo={
                        videoEditor.available && outputKind(detail.entry.src) === 'video'
                            ? () => videoEditor.edit(urlForPath(detail.full), detail.full)
                            : undefined
                    }
                    onStar={() => star(detail.full)}
                    onDownload={() => downloadImage(urlForPath(detail.full), detail.entry.src)}
                    onOpenFolder={canOpenFolder ? () => void openFolder(detail.full) : undefined}
                    onReuse={() => reuse(detail.entry)}
                    onUseAsInit={() => void useAsInit(detail)}
                    onDelete={() => setPendingDelete(detail.full)}
                    onOpenViewer={() => setViewing(true)}
                    onClose={() => setSelected(null)}
                />
            )}

            {detail && viewing && (
                <ImageLightbox
                    src={urlForPath(detail.full)}
                    alt={detail.entry.src}
                    title={detail.entry.src.split('/').pop() ?? detail.entry.src}
                    position={viewIndex < 0 ? undefined : { index: viewIndex + 1, total: filtered.length }}
                    onPrev={viewIndex > 0 ? () => step(-1) : undefined}
                    onNext={viewIndex >= 0 && viewIndex < filtered.length - 1 ? () => step(1) : undefined}
                    onClose={() => setViewing(false)}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t('history.deleteTitle')}
                body={
                    <>
                        <code className="font-mono text-fg">{pendingDelete}</code>{' '}
                        {t('history.deleteBody')}
                    </>
                }
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteOne(pendingDelete);
                    }
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />

            <ConfirmDialog
                open={pendingBulkDelete}
                title={t('history.bulkDeleteTitle', { count: selection.count })}
                body={t('history.bulkDeleteBody', { count: selection.count })}
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    setPendingBulkDelete(false);
                    void deleteSelected();
                }}
                onCancel={() => setPendingBulkDelete(false)}
            />

            {flash.node}

            {contextMenu.menu}
            {videoEditor.dialog}
        </div>
    );
}

function ImageSheet(props: {
    entry: ImageEntry;
    url: string;
    starred: boolean;
    canDelete: boolean;
    canUseAsInit: boolean;
    /** Only for a video, and only for a user who may run the editing routes. */
    onEditVideo?: () => void;
    onStar: () => void;
    onDownload: () => void;
    /** Only for a user allowed to have the server open its own folders. */
    onOpenFolder?: () => void;
    onReuse: () => void;
    onUseAsInit: () => void;
    onDelete: () => void;
    onOpenViewer: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const shownUrl = useProgressiveOutput(props.url);
    return (
        <DetailSheet label={t('history.imageDetails')} onClose={props.onClose}>
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle p-3">
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong" title={props.entry.src}>
                    {props.entry.src.split('/').pop()}
                </h2>
                <SheetIcon
                    label={props.starred ? t('common.unstar') : t('common.star')}
                    onClick={props.onStar}
                    color={props.starred ? 'var(--star)' : undefined}
                >
                    <Star size={15} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
                </SheetIcon>
                <SheetIcon label={t('common.download')} onClick={props.onDownload}>
                    <Download size={15} aria-hidden />
                </SheetIcon>
                {props.onOpenFolder && (
                    <SheetIcon label={t('history.openFolder')} onClick={props.onOpenFolder}>
                        <FolderOpen size={15} aria-hidden />
                    </SheetIcon>
                )}
                {props.canDelete && (
                    <SheetIcon label={t('history.deleteImage')} onClick={props.onDelete} color="var(--backend-errored)">
                        <Trash2 size={15} aria-hidden />
                    </SheetIcon>
                )}
                <SheetIcon label={t('common.closeDetails')} onClick={props.onClose}>
                    <X size={15} aria-hidden />
                </SheetIcon>
            </div>

            {/* Labelled with text, and worded the same way as the canvas buttons. */}
            <div className="flex shrink-0 gap-2 border-b border-subtle px-3 py-2">
                <SheetButton label={t('history.reuseParameters')} onClick={props.onReuse} />
                {props.canUseAsInit && (
                    <SheetButton label={t('history.useAsInit')} onClick={props.onUseAsInit} />
                )}
                {props.onEditVideo && (
                    <SheetButton label={t('videoEditor.open')} onClick={props.onEditVideo} />
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {/* The panel is only ever a few hundred pixels wide, so the image here is a
                    thumbnail of the detail being read; clicking it opens the real view of it.
                    It shows the grid's preview first - already cached, so the panel is never
                    empty - and upgrades to the file itself, which then opens instantly in the
                    viewer. A video or an audio file plays here instead: it carries its own
                    controls, and a click that both plays and zooms would do neither reliably. */}
                {outputKind(props.url) === 'image' ? (
                    <button
                        type="button"
                        onClick={props.onOpenViewer}
                        title={t('viewer.open')}
                        className="mb-3 block w-full cursor-zoom-in"
                    >
                        <img
                            src={shownUrl}
                            alt=""
                            className="max-h-72 w-full rounded border border-subtle object-contain lg:max-h-none"
                        />
                    </button>
                ) : (
                    <div className="mb-3">
                        <OutputPlayer
                            src={props.url}
                            label={props.entry.src}
                            className="max-h-72 w-full rounded border border-subtle object-contain"
                        />
                    </div>
                )}
                <MetadataView metadata={props.entry.metadata} empty={t('history.noMetadata')} />
            </div>
        </DetailSheet>
    );
}

function SheetIcon(props: {
    label: string;
    onClick: () => void;
    color?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            title={props.label}
            className="rounded p-1 hover:bg-[var(--sw-hover)]"
            style={{ color: props.color ?? 'var(--sw-fg-soft)' }}
        >
            {props.children}
        </button>
    );
}

function SheetButton(props: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className="rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
        >
            {props.label}
        </button>
    );
}
