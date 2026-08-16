import { useMemo, useState } from 'react';
import { Star, Trash2, X } from 'lucide-react';
import { useDeleteImage, useImages, useToggleImageStar } from '@/library/hooks';
import { imageOutPrefix, type ImageEntry, type ViewMode } from '@/library/types';
import { usePermission } from '@/api/permissions';
import { useSession } from '@/api/hooks';
import { BrowserToolbar, EmptyState, FolderPane } from './BrowserChrome';
import { ConfirmDialog } from '../ui/ConfirmDialog';

/** Output history browser.
 *
 * ListImages returns `src` paths relative to the *user's* output directory, so they need the
 * user-aware prefix from imageOutPrefix - `/View/<user_id>/...` or `/Output/...` depending on the
 * server's AppendUserNameToOutputPath setting. A bare `/View/<src>` 404s.
 * (Note this differs from the generation websocket, which already sends fully-prefixed paths.) */
/** Joins the browsed folder with a path-relative src from ListImages. */
function joinPath(folder: string, src: string): string {
    return folder ? `${folder}/${src}` : src;
}

export function HistoryBrowser() {
    const [path, setPath] = useState('');
    const [search, setSearch] = useState('');
    const [view, setView] = useState<ViewMode>('grid');
    const [reverse, setReverse] = useState(true);
    const [selected, setSelected] = useState<ImageEntry | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    const images = useImages(path, 'Date', reverse, 3);
    const toggleStar = useToggleImageStar();
    const deleteImage = useDeleteImage();
    const canDelete = usePermission('user_delete_image');
    const session = useSession();
    const prefix = imageOutPrefix(session.data?.user_id, session.data?.output_append_user);
    // ListImages returns `src` relative to the *requested path*, not to the output root, so the
    // current folder has to be joined back on. At root this is a no-op, which is what hid the bug.
    const urlFor = (src: string) => `/${prefix}/${path ? `${path}/` : ''}${src}`;

    const files = images.data?.files ?? [];
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query ? files.filter(f => f.src.toLowerCase().includes(query)) : files;
    }, [files, search]);

    return (
        <div className="flex h-full min-h-0">
            <FolderPane folders={images.data?.folders ?? []} path={path} onNavigate={setPath} />

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
                                <button
                                    key={file.src}
                                    type="button"
                                    onClick={() => setSelected(file)}
                                    title={file.src}
                                    className="group relative aspect-square overflow-hidden rounded border border-default bg-surface-sunken"
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
                            ))}
                        </div>
                    ) : (
                        <ul className="divide-y divide-[var(--light-border)]">
                            {filtered.map(file => (
                                <li key={file.src}>
                                    <button
                                        type="button"
                                        onClick={() => setSelected(file)}
                                        className="flex w-full items-center gap-3 py-1.5 text-left"
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

            {selected && (
                <ImageSheet
                    entry={selected}
                    url={urlFor(selected.src)}
                    canDelete={canDelete}
                    onStar={() => toggleStar.mutate({ path: joinPath(path, selected.src) })}
                    onDelete={() => setPendingDelete(joinPath(path, selected.src))}
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
                        setSelected(null);
                    }
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}

function ImageSheet(props: {
    entry: ImageEntry;
    url: string;
    canDelete: boolean;
    onStar: () => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const metadata = useMemo(() => {
        if (!props.entry.metadata) {
            return null;
        }
        try {
            return JSON.stringify(JSON.parse(props.entry.metadata), null, 2);
        }
        catch {
            return props.entry.metadata;
        }
    }, [props.entry.metadata]);

    return (
        <aside
            aria-label="Image details"
            className="flex w-96 shrink-0 flex-col border-l border-subtle bg-surface"
        >
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle p-3">
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong" title={props.entry.src}>
                    {props.entry.src.split('/').pop()}
                </h2>
                <button
                    type="button"
                    onClick={props.onStar}
                    aria-label="Toggle star"
                    title="Toggle star"
                    className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <Star size={15} aria-hidden />
                </button>
                {props.canDelete && (
                    <button
                        type="button"
                        onClick={props.onDelete}
                        aria-label="Delete image"
                        title="Delete image"
                        className="rounded p-1 hover:bg-[var(--sw-hover)]"
                        style={{ color: 'var(--backend-errored)' }}
                    >
                        <Trash2 size={15} aria-hidden />
                    </button>
                )}
                <button
                    type="button"
                    onClick={props.onClose}
                    aria-label="Close details"
                    className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <X size={15} aria-hidden />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <img
                    src={props.url}
                    alt=""
                    className="mb-3 w-full rounded border border-subtle"
                />
                <h3 className="mb-1 text-xs uppercase tracking-wide text-fg-soft">Metadata</h3>
                {metadata ? (
                    <pre className="whitespace-pre-wrap break-words rounded border border-subtle bg-surface-sunken p-2 font-mono text-[11px] text-fg-soft">
                        {metadata}
                    </pre>
                ) : (
                    <p className="text-sm text-fg-soft">No metadata recorded.</p>
                )}
            </div>
        </aside>
    );
}
