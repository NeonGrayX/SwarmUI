import { useEffect, useMemo, useState } from 'react';
import { Download, Star, Trash2, X } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useDeleteImage, useImages, useToggleImageStar } from '@/library/hooks';
import {
    imageOutPrefix,
    isImageStarred,
    type ImageEntry,
    type ImageSortMode,
    type ViewMode
} from '@/library/types';
import { usePermission } from '@/api/permissions';
import { useSession } from '@/api/hooks';
import { useReuseParameters } from '@/params/reuse';
import { useMediaParamAction } from '@/params/useMediaParamAction';
import { BrowserToolbar, EmptyState, FolderPane, IMAGE_SORTS, StarButton } from './BrowserChrome';
import { DetailSheet } from '../ui/DetailSheet';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ImageLightbox } from '../ui/ImageLightbox';
import { OutputPlayer, OutputThumbnail, outputKind } from '../ui/OutputMedia';
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
    const [path, setPath] = useState('');
    const [search, setSearch] = useState('');
    const [view, setView] = useState<ViewMode>('grid');
    // Newest first: sorting by date and reversing is what makes the last thing generated the first
    // thing on screen, which is what the history screen is usually opened for.
    const [sort, setSort] = useState<ImageSortMode>('Date');
    const [reverse, setReverse] = useState(true);
    // Subfolders are per-model or per-day, so a couple of levels of them is the usual shape of an
    // output folder; deeper is available but is the user's call, since the server walks every level.
    const [depth, setDepth] = useState(3);
    const [selected, setSelected] = useState<PinnedImage | null>(null);
    const [viewing, setViewing] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

    const [flash, setFlash] = useState<string | null>(null);

    const images = useImages(path, sort, reverse, depth);
    const toggleStar = useToggleImageStar();
    const deleteImage = useDeleteImage();
    const canDelete = usePermission('user_delete_image');
    const session = useSession();
    const navigate = useNavigate();
    const reuseParameters = useReuseParameters();
    const mediaParam = useMediaParamAction();
    const contextMenu = useContextMenu();
    const videoEditor = useVideoEditor();
    const prefix = imageOutPrefix(session.data?.user_id, session.data?.output_append_user);
    const urlForPath = (full: string) => `/${prefix}/${full}`;
    // ListImages returns `src` relative to the *requested path*, not to the output root, so the
    // current folder has to be joined back on. At root that is a no-op.
    const urlFor = (src: string) => urlForPath(joinPath(path, src));

    const files = images.data?.files ?? EMPTY;
    // Every entry carries its whole generation metadata as a JSON string, and all the listing
    // wants from it is the star. Parsed once per listing here rather than once per card per
    // render, which on a folder of a few thousand images was megabytes of JSON per keystroke.
    const starredSrcs = useMemo(
        () => new Set(files.filter(file => isImageStarred(file.metadata)).map(file => file.src)),
        [files]
    );
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query ? files.filter(f => f.src.toLowerCase().includes(query)) : files;
    }, [files, search]);

    // An output folder is routinely thousands of images; draw it as it is scrolled through.
    const shown = useIncremental(filtered);

    const ids = useMemo(() => filtered.map(file => file.src), [filtered]);
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
            ? { ...selected, entry: fresh, starred: isImageStarred(fresh.metadata) }
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

    // Failures are worth saying out loud; successes leave for the Generate screen and speak for
    // themselves there.
    useEffect(() => {
        if (flash) {
            const timer = setTimeout(() => setFlash(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [flash]);

    /** Pairs an entry with the folder it was listed in, for anything that outlives the listing. */
    function pin(entry: ImageEntry): PinnedImage {
        return {
            entry,
            full: joinPath(path, entry.src),
            starred: isImageStarred(entry.metadata)
        };
    }

    /** Stars or unstars one image. The refreshed list answers for anything still on screen; the
     *  pinned sheet has to be told directly, since it may be showing another folder's image. */
    function star(full: string): void {
        toggleStar.mutate({ path: full }, {
            onSuccess: () => setSelected(current =>
                current && current.full === full ? { ...current, starred: !current.starred } : current)
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
            setFlash(error instanceof Error ? error.message : t('history.reuseFailed'));
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
            setFlash(error instanceof Error ? error.message : t('history.initImageFailed'));
            return;
        }
        navigate({ to: '/generate' });
    }

    /** Saves every selected image, oldest-listed first. */
    async function downloadSelected(): Promise<void> {
        for (const src of selection.ids) {
            downloadImage(urlFor(src), src);
            await delay(200);
        }
    }

    /** Deletes every selected image. One request per file - the API has no batch form - so a
     *  failure part-way leaves the earlier deletions done, which the refreshed list shows. */
    async function deleteSelected(): Promise<void> {
        const targets = selection.ids.map(src => joinPath(path, src));
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
            setFlash(error instanceof Error ? error.message : t('history.bulkDeleteFailed'));
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
            { label: t('common.download'), onSelect: () => downloadImage(urlFor(entry.src), entry.src) },
            { label: t('history.reuseParameters'), separated: true, onSelect: () => reuse(entry) }
        ];
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
            <FolderPane folders={images.data?.folders} path={path} onNavigate={setPath} />

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
                />

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
                                search
                                    ? t('history.noSearchMatches', { search: search.trim() })
                                    : t('history.noImages')
                            }
                            hint={search ? undefined : t('history.noImagesHint')}
                        />
                    ) : view === 'grid' ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
                            {shown.visible.map(file => (
                                <div
                                    key={file.src}
                                    onContextMenu={event => contextMenu.open(event, actionsFor(file))}
                                    {...contextMenu.touch(() => actionsFor(file))}
                                    className={[
                                        'group relative aspect-square overflow-hidden rounded border bg-surface-sunken',
                                        selection.isSelected(file.src)
                                            ? 'border-[var(--emphasis)]'
                                            : 'border-default'
                                    ].join(' ')}
                                >
                                    <button
                                        type="button"
                                        onClick={event => selection.click(event, file.src, () => setSelected(pin(file)))}
                                        title={`${file.src}\n${t('browser.rightClickForActions')}`}
                                        className="block h-full w-full"
                                    >
                                        <OutputThumbnail
                                            src={urlFor(file.src)}
                                            alt={file.src}
                                            className="h-full w-full object-cover"
                                        />
                                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                                            {file.src.split('/').pop()}
                                        </span>
                                    </button>
                                    <span className="absolute left-1.5 top-1.5">
                                        <SelectionCheckbox
                                            overlay
                                            checked={selection.isSelected(file.src)}
                                            onToggle={() => selection.toggle(file.src)}
                                            label={t('browser.selectEntry', { name: file.src })}
                                        />
                                    </span>
                                    <span className="absolute right-1.5 top-1.5">
                                        <StarButton
                                            starred={starredSrcs.has(file.src)}
                                            variant="overlay"
                                            onClick={() => star(joinPath(path, file.src))}
                                        />
                                    </span>
                                </div>
                            ))}
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
                                        checked={selection.isSelected(file.src)}
                                        onToggle={() => selection.toggle(file.src)}
                                        label={t('browser.selectEntry', { name: file.src })}
                                    />
                                    <StarButton
                                        starred={starredSrcs.has(file.src)}
                                        variant="plain"
                                        onClick={() => star(joinPath(path, file.src))}
                                    />
                                    <button
                                        type="button"
                                        onClick={event => selection.click(event, file.src, () => setSelected(pin(file)))}
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
                        deleteImage.mutate({ path: pendingDelete });
                        // Only the sheet showing *that* image closes; another one stays put.
                        setSelected(current => (current?.full === pendingDelete ? null : current));
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

            {flash && (
                <p
                    role="status"
                    className="absolute bottom-3 right-3 z-40 max-w-96 rounded border border-default bg-surface px-2 py-1 text-xs text-fg-soft shadow-lg"
                >
                    {flash}
                </p>
            )}

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
    onReuse: () => void;
    onUseAsInit: () => void;
    onDelete: () => void;
    onOpenViewer: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
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
                    A video or an audio file plays here instead: it carries its own controls, and
                    a click that both plays and zooms would do neither reliably. */}
                {outputKind(props.url) === 'image' ? (
                    <button
                        type="button"
                        onClick={props.onOpenViewer}
                        title={t('viewer.open')}
                        className="mb-3 block w-full cursor-zoom-in"
                    >
                        <img
                            src={props.url}
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
