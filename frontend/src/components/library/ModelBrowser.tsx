import { useMemo, useState } from 'react';
import { CheckCircle2, ImageOff, MoreVertical, Star } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
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
import { BrowserToolbar, EmptyState, FolderPane } from './BrowserChrome';
import { ModelDetailSheet } from './ModelDetailSheet';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PromptDialog } from '../ui/PromptDialog';

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

    const models = useModels(props.subtype, path, sort, reverse, 3);
    const userData = useMyUserData();
    const toggleStar = useToggleStar();
    const deleteModel = useDeleteModel();
    const renameModel = useRenameModel();

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

    return (
        <div className="flex h-full min-h-0">
            <FolderPane folders={models.data?.folders ?? []} path={path} onNavigate={setPath} />

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
                                    onStar={() => toggleStar.mutate({ subtype: props.subtype, name: file.name })}
                                    onOpen={() => setSelected(file)}
                                    onDelete={canDelete ? () => setPendingDelete(file.name) : undefined}
                                    onRename={canEdit ? () => setPendingRename(file.name) : undefined}
                                    canEdit={canEdit}
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
                                    onStar={() => toggleStar.mutate({ subtype: props.subtype, name: file.name })}
                                    onOpen={() => setSelected(file)}
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
        </div>
    );
}

function Card(props: {
    file: ModelCard | WildcardCard;
    starred: boolean;
    onStar: () => void;
    onOpen: () => void;
    onDelete?: () => void;
    onRename?: () => void;
    canEdit: boolean;
}) {
    const { file } = props;
    const card = isModelCard(file) ? file : null;
    const image = previewUrl(card ? card.preview_image : (file as WildcardCard).image);
    const selectModel = useSelectModel();

    return (
        <div className="group relative overflow-hidden rounded-lg border border-default bg-surface">
            <button
                type="button"
                onClick={props.onOpen}
                className="block w-full text-left"
                title={file.name}
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

            {card?.loaded && (
                <span
                    title="Loaded on a backend"
                    className="absolute left-1.5 top-1.5 rounded-full bg-black/60 p-1"
                    style={{ color: 'var(--backend-running)' }}
                >
                    <CheckCircle2 size={13} aria-hidden />
                </span>
            )}

            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <IconChip
                    label={props.starred ? 'Unstar' : 'Star'}
                    onClick={props.onStar}
                    active={props.starred}
                >
                    <Star size={13} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
                </IconChip>
                <Popover.Root>
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            aria-label="More actions"
                            className="rounded-full bg-black/60 p-1 text-white/80 hover:text-white"
                        >
                            <MoreVertical size={13} aria-hidden />
                        </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content
                            side="bottom"
                            align="end"
                            sideOffset={4}
                            className="z-50 min-w-40 rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                        >
                            <MenuItem label="Details" onClick={props.onOpen} />
                            {card && (
                                <MenuItem
                                    label="Load on backends"
                                    onClick={() => selectModel.mutate({ name: file.name })}
                                />
                            )}
                            {props.onRename && <MenuItem label="Rename…" onClick={props.onRename} />}
                            {props.onDelete && (
                                <MenuItem label="Delete…" destructive onClick={props.onDelete} />
                            )}
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
            </div>
        </div>
    );
}

function Row(props: {
    file: ModelCard | WildcardCard;
    starred: boolean;
    onStar: () => void;
    onOpen: () => void;
}) {
    const card = isModelCard(props.file) ? props.file : null;
    const image = previewUrl(card ? card.preview_image : (props.file as WildcardCard).image);

    return (
        <li className="flex items-center gap-3 py-1.5">
            <IconChip label={props.starred ? 'Unstar' : 'Star'} onClick={props.onStar} active={props.starred} plain>
                <Star size={14} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
            </IconChip>
            <button type="button" onClick={props.onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
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

function IconChip(props: {
    label: string;
    onClick: () => void;
    active?: boolean;
    plain?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            title={props.label}
            className={[
                'rounded-full p-1 transition-colors',
                props.plain ? 'hover:bg-[var(--sw-hover)]' : 'bg-black/60',
                props.active ? '' : props.plain ? 'text-fg-soft hover:text-fg' : 'text-white/80 hover:text-white'
            ].join(' ')}
            style={props.active ? { color: 'var(--star)' } : undefined}
        >
            {props.children}
        </button>
    );
}

function MenuItem(props: { label: string; onClick: () => void; destructive?: boolean }) {
    return (
        <Popover.Close asChild>
            <button
                type="button"
                onClick={props.onClick}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--sw-hover)]"
                style={{ color: props.destructive ? 'var(--backend-errored)' : 'var(--text)' }}
            >
                {props.label}
            </button>
        </Popover.Close>
    );
}
