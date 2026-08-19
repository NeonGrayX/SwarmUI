import { useEffect, useMemo, useState } from 'react';
import { Download, Star, Trash2, X } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useDeleteImage, useImages, useToggleImageStar } from '@/library/hooks';
import { imageOutPrefix, isImageStarred, type ImageEntry, type ViewMode } from '@/library/types';
import { usePermission } from '@/api/permissions';
import { useSession } from '@/api/hooks';
import { useReuseParameters } from '@/params/reuse';
import { useMediaParamAction } from '@/params/useMediaParamAction';
import { BrowserToolbar, EmptyState, FolderPane, StarButton } from './BrowserChrome';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { MetadataView } from '../ui/MetadataView';
import { useContextMenu, type MenuAction } from '../ui/ContextMenu';

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
 * server's AppendUserNameToOutputPath setting. A bare `/View/<src>` 404s.
 * (Note this differs from the generation websocket, which already sends fully-prefixed paths.) */
export function HistoryBrowser() {
    const [path, setPath] = useState('');
    const [search, setSearch] = useState('');
    const [view, setView] = useState<ViewMode>('grid');
    const [reverse, setReverse] = useState(true);
    const [selected, setSelected] = useState<PinnedImage | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

    const [flash, setFlash] = useState<string | null>(null);

    const images = useImages(path, 'Date', reverse, 3);
    const toggleStar = useToggleImageStar();
    const deleteImage = useDeleteImage();
    const canDelete = usePermission('user_delete_image');
    const session = useSession();
    const navigate = useNavigate();
    const reuseParameters = useReuseParameters();
    const mediaParam = useMediaParamAction();
    const contextMenu = useContextMenu();
    const prefix = imageOutPrefix(session.data?.user_id, session.data?.output_append_user);
    const urlForPath = (full: string) => `/${prefix}/${full}`;
    // ListImages returns `src` relative to the *requested path*, not to the output root, so the
    // current folder has to be joined back on. At root this is a no-op, which is what hid the bug.
    const urlFor = (src: string) => urlForPath(joinPath(path, src));

    const files = images.data?.files ?? [];
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query ? files.filter(f => f.src.toLowerCase().includes(query)) : files;
    }, [files, search]);

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

    /** Loads an image's parameters into the generation form and switches to it. */
    function reuse(entry: ImageEntry): void {
        try {
            reuseParameters(entry.metadata);
            navigate({ to: '/generate' });
        }
        catch (error: unknown) {
            setFlash(error instanceof Error ? error.message : 'Could not reuse these parameters.');
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
            setFlash(error instanceof Error ? error.message : 'Could not set the init image.');
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
            setFlash(error instanceof Error ? error.message : 'Could not delete every selected image.');
        }
    }

    /** Everything one image can do, for its right-click menu. */
    function actionsFor(entry: ImageEntry): MenuAction[] {
        const image = pin(entry);
        const actions: MenuAction[] = [
            { label: 'Details', onSelect: () => setSelected(image) },
            {
                label: image.starred ? 'Unstar' : 'Star',
                onSelect: () => star(image.full)
            },
            { label: 'Download', onSelect: () => downloadImage(urlFor(entry.src), entry.src) },
            { label: 'Reuse parameters', separated: true, onSelect: () => reuse(entry) }
        ];
        if (mediaParam.available('initimage')) {
            actions.push({ label: 'Use as init', onSelect: () => void useAsInit(image) });
        }
        if (canDelete) {
            actions.push({
                label: 'Delete…',
                destructive: true,
                separated: true,
                onSelect: () => setPendingDelete(image.full)
            });
        }
        return actions;
    }

    return (
        <div className="relative flex h-full min-h-0">
            <FolderPane folders={images.data?.folders} path={path} onNavigate={setPath} />

            <div className="flex min-w-0 flex-1 flex-col">
                <BrowserToolbar
                    search={search}
                    onSearch={setSearch}
                    view={view}
                    onView={setView}
                    reverse={reverse}
                    onReverse={setReverse}
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
                        <SelectionButton label="Download" onClick={() => void downloadSelected()}>
                            <Download size={13} aria-hidden />
                        </SelectionButton>
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
                    {images.isPending ? (
                        <EmptyState title="Loading history…" />
                    ) : images.isError ? (
                        <EmptyState
                            title="Couldn't load history."
                            hint={images.error instanceof Error ? images.error.message : undefined}
                        />
                    ) : filtered.length === 0 ? (
                        <EmptyState
                            title={search ? `No images match "${search.trim()}".` : 'No images yet.'}
                            hint={search ? undefined : 'Generated images are saved here automatically.'}
                        />
                    ) : view === 'grid' ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
                            {filtered.map(file => (
                                <div
                                    key={file.src}
                                    onContextMenu={event => contextMenu.open(event, actionsFor(file))}
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
                                        title={`${file.src}\nRight-click for actions`}
                                        className="block h-full w-full"
                                    >
                                        <img
                                            src={urlFor(file.src)}
                                            alt=""
                                            loading="lazy"
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
                                            label={`Select ${file.src}`}
                                        />
                                    </span>
                                    <span className="absolute right-1.5 top-1.5">
                                        <StarButton
                                            starred={isImageStarred(file.metadata)}
                                            variant="overlay"
                                            onClick={() => star(joinPath(path, file.src))}
                                        />
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <ul className="divide-y divide-[var(--light-border)]">
                            {filtered.map(file => (
                                <li
                                    key={file.src}
                                    onContextMenu={event => contextMenu.open(event, actionsFor(file))}
                                    className="group flex items-center gap-3"
                                >
                                    <SelectionCheckbox
                                        checked={selection.isSelected(file.src)}
                                        onToggle={() => selection.toggle(file.src)}
                                        label={`Select ${file.src}`}
                                    />
                                    <StarButton
                                        starred={isImageStarred(file.metadata)}
                                        variant="plain"
                                        onClick={() => star(joinPath(path, file.src))}
                                    />
                                    <button
                                        type="button"
                                        onClick={event => selection.click(event, file.src, () => setSelected(pin(file)))}
                                        title={`${file.src}\nRight-click for actions`}
                                        className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
                                    >
                                        <span className="size-9 shrink-0 overflow-hidden rounded bg-surface-sunken">
                                            <img
                                                src={urlFor(file.src)}
                                                alt=""
                                                loading="lazy"
                                                className="h-full w-full object-cover"
                                            />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{file.src}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {detail && (
                <ImageSheet
                    entry={detail.entry}
                    url={urlForPath(detail.full)}
                    starred={detail.starred}
                    canDelete={canDelete}
                    canUseAsInit={mediaParam.available('initimage')}
                    onStar={() => star(detail.full)}
                    onDownload={() => downloadImage(urlForPath(detail.full), detail.entry.src)}
                    onReuse={() => reuse(detail.entry)}
                    onUseAsInit={() => void useAsInit(detail)}
                    onDelete={() => setPendingDelete(detail.full)}
                    onClose={() => setSelected(null)}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Delete image?"
                body={
                    <>
                        <code className="font-mono text-fg">{pendingDelete}</code> will be deleted.
                        Depending on server settings it may go to a recycle folder rather than being
                        removed permanently.
                    </>
                }
                confirmLabel="Delete"
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
                title={`Delete ${selection.count} images?`}
                body={
                    <>
                        All <strong className="text-fg">{selection.count}</strong> selected images will
                        be deleted. Depending on server settings they may go to a recycle folder rather
                        than being removed permanently.
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

            {flash && (
                <p
                    role="status"
                    className="absolute bottom-3 right-3 z-40 max-w-96 rounded border border-default bg-surface px-2 py-1 text-xs text-fg-soft shadow-lg"
                >
                    {flash}
                </p>
            )}

            {contextMenu.menu}
        </div>
    );
}

function ImageSheet(props: {
    entry: ImageEntry;
    url: string;
    starred: boolean;
    canDelete: boolean;
    canUseAsInit: boolean;
    onStar: () => void;
    onDownload: () => void;
    onReuse: () => void;
    onUseAsInit: () => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    return (
        <aside
            aria-label="Image details"
            className="flex w-96 shrink-0 flex-col border-l border-subtle bg-surface"
        >
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle p-3">
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong" title={props.entry.src}>
                    {props.entry.src.split('/').pop()}
                </h2>
                <SheetIcon
                    label={props.starred ? 'Unstar' : 'Star'}
                    onClick={props.onStar}
                    color={props.starred ? 'var(--star)' : undefined}
                >
                    <Star size={15} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
                </SheetIcon>
                <SheetIcon label="Download" onClick={props.onDownload}>
                    <Download size={15} aria-hidden />
                </SheetIcon>
                {props.canDelete && (
                    <SheetIcon label="Delete image" onClick={props.onDelete} color="var(--backend-errored)">
                        <Trash2 size={15} aria-hidden />
                    </SheetIcon>
                )}
                <SheetIcon label="Close details" onClick={props.onClose}>
                    <X size={15} aria-hidden />
                </SheetIcon>
            </div>

            {/* Spelled out rather than iconified: which button reuses what is exactly the thing an
                icon strip makes you hover to find out. Same wording as the canvas buttons. */}
            <div className="flex shrink-0 gap-2 border-b border-subtle px-3 py-2">
                <SheetButton label="Reuse parameters" onClick={props.onReuse} />
                {props.canUseAsInit && <SheetButton label="Use as init" onClick={props.onUseAsInit} />}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <img
                    src={props.url}
                    alt=""
                    className="mb-3 w-full rounded border border-subtle"
                />
                <MetadataView metadata={props.entry.metadata} empty="No metadata recorded." />
            </div>
        </aside>
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
