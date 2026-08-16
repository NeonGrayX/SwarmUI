import { ChevronRight, Folder, Grid3x3, List, Search, X } from 'lucide-react';
import type { SortMode, ViewMode } from '@/library/types';

/** Breadcrumb + folder list for the current path.
 *
 * The legacy browsers render a bare nested tree of links with no indication of where you are;
 * this pairs an explicit breadcrumb with the child folders of the current level. */
export function FolderPane(props: {
    folders: string[];
    path: string;
    onNavigate: (path: string) => void;
}) {
    const segments = props.path.split('/').filter(Boolean);

    return (
        <nav aria-label="Folders" className="w-56 shrink-0 overflow-y-auto border-r border-subtle p-2">
            <ol className="mb-2 flex flex-wrap items-center gap-0.5 text-xs">
                <li>
                    <button
                        type="button"
                        onClick={() => props.onNavigate('')}
                        className="rounded px-1 py-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        Root
                    </button>
                </li>
                {segments.map((segment, i) => (
                    <li key={segment + i} className="flex items-center gap-0.5">
                        <ChevronRight size={11} className="text-fg-soft" aria-hidden />
                        <button
                            type="button"
                            onClick={() => props.onNavigate(segments.slice(0, i + 1).join('/'))}
                            className="max-w-28 truncate rounded px-1 py-0.5 text-fg hover:bg-[var(--sw-hover)]"
                        >
                            {segment}
                        </button>
                    </li>
                ))}
            </ol>

            {props.folders.length === 0 ? (
                <p className="px-1 text-xs text-fg-soft">No subfolders.</p>
            ) : (
                <ul className="space-y-0.5">
                    {props.folders.map(folder => (
                        <li key={folder}>
                            <button
                                type="button"
                                onClick={() =>
                                    props.onNavigate(props.path ? `${props.path}/${folder}` : folder)
                                }
                                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                            >
                                <Folder size={14} className="shrink-0" aria-hidden />
                                <span className="truncate">{folder}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </nav>
    );
}

const SORTS: { id: SortMode; label: string }[] = [
    { id: 'Name', label: 'Name' },
    { id: 'Title', label: 'Title' },
    { id: 'DateCreated', label: 'Date created' },
    { id: 'DateModified', label: 'Date modified' }
];

export function BrowserToolbar(props: {
    search: string;
    onSearch: (value: string) => void;
    view: ViewMode;
    onView: (view: ViewMode) => void;
    sort?: SortMode;
    onSort?: (sort: SortMode) => void;
    reverse: boolean;
    onReverse: (reverse: boolean) => void;
    count: number;
    total: number;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-3 py-2">
            <div className="relative min-w-48 flex-1 max-w-sm">
                <Search
                    size={14}
                    aria-hidden
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                />
                <input
                    type="search"
                    value={props.search}
                    onChange={e => props.onSearch(e.target.value)}
                    placeholder="Search…"
                    aria-label="Search"
                    className="w-full rounded border border-default bg-surface-sunken py-1 pl-7 pr-7 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />
                {props.search && (
                    <button
                        type="button"
                        onClick={() => props.onSearch('')}
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                    >
                        <X size={13} aria-hidden />
                    </button>
                )}
            </div>

            {props.sort && props.onSort && (
                <label className="flex items-center gap-1.5 text-xs text-fg-soft">
                    Sort
                    <select
                        value={props.sort}
                        onChange={e => props.onSort?.(e.target.value as SortMode)}
                        className="rounded border border-default bg-surface-sunken px-1.5 py-1 text-xs text-fg outline-none focus:border-[var(--emphasis)]"
                    >
                        {SORTS.map(sort => (
                            <option key={sort.id} value={sort.id}>
                                {sort.label}
                            </option>
                        ))}
                    </select>
                </label>
            )}

            <label className="flex cursor-pointer items-center gap-1 text-xs text-fg-soft">
                <input
                    type="checkbox"
                    checked={props.reverse}
                    onChange={e => props.onReverse(e.target.checked)}
                    className="accent-[var(--emphasis)]"
                />
                Reverse
            </label>

            {props.children}

            <div className="flex-1" />

            <span className="text-xs text-fg-soft tabular-nums">
                {props.count === props.total ? props.total : `${props.count} of ${props.total}`}
            </span>

            <div className="flex rounded border border-default overflow-hidden">
                <ViewButton
                    active={props.view === 'grid'}
                    label="Grid view"
                    onClick={() => props.onView('grid')}
                >
                    <Grid3x3 size={14} aria-hidden />
                </ViewButton>
                <ViewButton
                    active={props.view === 'list'}
                    label="List view"
                    onClick={() => props.onView('list')}
                >
                    <List size={14} aria-hidden />
                </ViewButton>
            </div>
        </div>
    );
}

function ViewButton(props: {
    active: boolean;
    label: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            aria-pressed={props.active}
            title={props.label}
            className={[
                'px-1.5 py-1 transition-colors',
                props.active ? 'text-fg-strong bg-[var(--sw-active)]' : 'text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]'
            ].join(' ')}
        >
            {props.children}
        </button>
    );
}

export function EmptyState(props: { title: string; hint?: string }) {
    return (
        <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
                <p className="text-fg-soft">{props.title}</p>
                {props.hint && <p className="mt-1 text-sm text-fg-soft">{props.hint}</p>}
            </div>
        </div>
    );
}
