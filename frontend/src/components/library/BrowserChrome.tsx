import { useEffect, useState } from 'react';
import { ChevronRight, Folder, Grid3x3, List, Search, Star, X } from 'lucide-react';
import type { SortMode, ViewMode } from '@/library/types';
import { SideNav } from '../ui/SideNav';
import { t as translate, useTranslation } from '@/i18n';

/** Child folder names keyed by their absolute parent path ('' is the root). */
type FolderTree = ReadonlyMap<string, string[]>;

/** Joins a folder path with a path relative to it. */
function joinFolder(base: string, relative: string): string {
    if (!relative) {
        return base;
    }
    return base ? `${base}/${relative}` : relative;
}

/** Folds one list response into the known tree.
 *
 * The list endpoints only describe the levels below the requested path that they walked (three,
 * here), so a tree that survives navigation has to be stitched together from every response seen
 * so far: group the returned relative paths by parent and replace exactly those entries, leaving
 * branches and deeper levels the server did not mention as previously discovered. Mirrors
 * refillTree in the legacy browser (src/wwwroot/js/genpage/helpers/browsers.js). */
function mergeFolders(known: FolderTree, path: string, folders: string[]): FolderTree {
    const fetched = new Map<string, string[]>([[path, []]]);
    for (const folder of folders) {
        const parts = folder.split('/').filter(Boolean);
        const name = parts.pop();
        if (name === undefined) {
            continue;
        }
        const parent = joinFolder(path, parts.join('/'));
        const siblings = fetched.get(parent);
        if (!siblings) {
            fetched.set(parent, [name]);
        }
        else if (!siblings.includes(name)) {
            siblings.push(name);
        }
    }
    let changed = false;
    const next = new Map(known);
    for (const [parent, children] of fetched) {
        const previous = next.get(parent);
        if (!previous || previous.length !== children.length || previous.some((c, i) => c !== children[i])) {
            next.set(parent, children);
            changed = true;
        }
    }
    // Returning the original when nothing moved keeps the merge effect from looping.
    return changed ? next : known;
}

/** The path itself plus every folder above it. */
function ancestorsOf(path: string): string[] {
    const segments = path.split('/').filter(Boolean);
    return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

/** Breadcrumb + expandable folder tree for the current path.
 *
 * The legacy browsers render a bare nested tree of links with no indication of where you are;
 * this pairs an explicit breadcrumb with a tree whose parents expand in place. `folders` is
 * undefined while a folder's contents are still loading, which leaves the tree untouched rather
 * than momentarily collapsing the branch being opened.
 *
 * On a phone the whole thing folds into one row via <SideNav>, showing the current folder's name.
 * Only the explicit navigation buttons close it: opening a branch below the fetched depth also
 * calls `onNavigate`, to go and load that level, and must leave the tree on screen. */
export function FolderPane(props: {
    folders: string[] | undefined;
    path: string;
    onNavigate: (path: string) => void;
}) {
    const { t } = useTranslation();
    const segments = props.path.split('/').filter(Boolean);
    const [tree, setTree] = useState<FolderTree>(() => new Map());
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

    const { folders, path } = props;
    useEffect(() => {
        if (folders) {
            setTree(known => mergeFolders(known, path, folders));
        }
    }, [folders, path]);

    // A folder can only be shown as current if everything above it is open.
    useEffect(() => {
        setExpanded(open => {
            const ancestors = ancestorsOf(path).filter(a => !open.has(a));
            return ancestors.length === 0 ? open : new Set([...open, ...ancestors]);
        });
    }, [path]);

    function toggle(folder: string, children: string[] | undefined) {
        const opening = !expanded.has(folder);
        setExpanded(open => {
            const next = new Set(open);
            if (opening) {
                next.add(folder);
            }
            else {
                next.delete(folder);
            }
            return next;
        });
        // Below the fetched depth the children are unknown, so opening has to go get them.
        if (opening && children === undefined) {
            props.onNavigate(folder);
        }
    }

    const roots = tree.get('') ?? [];

    return (
        <SideNav
            label={t('browser.folders')}
            summary={segments.length === 0 ? t('browser.root') : segments[segments.length - 1]}
        >
            {close => (
                <>
                    <ol className="mb-2 flex flex-wrap items-center gap-0.5 text-xs">
                        <li>
                            <button
                                type="button"
                                onClick={() => {
                                    props.onNavigate('');
                                    close();
                                }}
                                className="rounded px-1 py-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('browser.root')}
                            </button>
                        </li>
                        {segments.map((segment, i) => (
                            <li key={segment + i} className="flex items-center gap-0.5">
                                <ChevronRight size={11} className="text-fg-soft" aria-hidden />
                                <button
                                    type="button"
                                    onClick={() => {
                                        props.onNavigate(segments.slice(0, i + 1).join('/'));
                                        close();
                                    }}
                                    className="max-w-28 truncate rounded px-1 py-0.5 text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    {segment}
                                </button>
                            </li>
                        ))}
                    </ol>

                    {roots.length === 0 ? (
                        <p className="px-1 text-xs text-fg-soft">{t('browser.noSubfolders')}</p>
                    ) : (
                        <ul className="space-y-0.5">
                            {roots.map(folder => (
                                <FolderNode
                                    key={folder}
                                    name={folder}
                                    path={folder}
                                    level={0}
                                    tree={tree}
                                    expanded={expanded}
                                    onToggle={toggle}
                                    current={props.path}
                                    onNavigate={path => {
                                        props.onNavigate(path);
                                        close();
                                    }}
                                />
                            ))}
                        </ul>
                    )}
                </>
            )}
        </SideNav>
    );
}

function FolderNode(props: {
    name: string;
    /** Absolute path of this folder, ie what navigating to it selects. */
    path: string;
    level: number;
    tree: FolderTree;
    expanded: ReadonlySet<string>;
    onToggle: (path: string, children: string[] | undefined) => void;
    current: string;
    onNavigate: (path: string) => void;
}) {
    const children = props.tree.get(props.path);
    const isOpen = props.expanded.has(props.path);
    const isCurrent = props.current === props.path;
    // Unknown children (below the fetched depth) still get a toggle - opening one loads that level,
    // and the toggle disappears afterwards if the folder turns out to be empty.
    const canExpand = children === undefined || children.length > 0;

    return (
        <li>
            <div
                style={{ paddingLeft: `${props.level * 12}px` }}
                className={[
                    'flex items-center rounded',
                    isCurrent
                        ? 'bg-[var(--sw-active)] text-fg-strong'
                        : 'text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
                ].join(' ')}
            >
                {canExpand ? (
                    <button
                        type="button"
                        onClick={() => props.onToggle(props.path, children)}
                        aria-expanded={isOpen}
                        aria-label={
                            isOpen
                                ? translate('browser.collapseFolder', { name: props.name })
                                : translate('browser.expandFolder', { name: props.name })
                        }
                        className="shrink-0 rounded p-0.5 hover:bg-[var(--sw-hover)]"
                    >
                        <ChevronRight
                            size={12}
                            aria-hidden
                            className={['transition-transform', isOpen ? 'rotate-90' : ''].join(' ')}
                        />
                    </button>
                ) : (
                    <span className="w-[18px] shrink-0" aria-hidden />
                )}
                <button
                    type="button"
                    onClick={() => props.onNavigate(props.path)}
                    aria-current={isCurrent ? 'true' : undefined}
                    title={props.name}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 pr-1.5 text-left text-sm"
                >
                    <Folder size={14} className="shrink-0" aria-hidden />
                    <span className="truncate">{props.name}</span>
                </button>
            </div>

            {isOpen && children && children.length > 0 && (
                <ul className="space-y-0.5">
                    {children.map(child => (
                        <FolderNode
                            key={child}
                            name={child}
                            path={joinFolder(props.path, child)}
                            level={props.level + 1}
                            tree={props.tree}
                            expanded={props.expanded}
                            onToggle={props.onToggle}
                            current={props.current}
                            onNavigate={props.onNavigate}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

const SORTS: { id: SortMode; labelKey: string }[] = [
    { id: 'Name', labelKey: 'browser.sort.name' },
    { id: 'Title', labelKey: 'browser.sort.title' },
    { id: 'DateCreated', labelKey: 'browser.sort.dateCreated' },
    { id: 'DateModified', labelKey: 'browser.sort.dateModified' }
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
    const { t } = useTranslation();
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
                    placeholder={t('common.searchPlaceholder')}
                    aria-label={t('common.search')}
                    className="w-full rounded border border-default bg-surface-sunken py-1 pl-7 pr-7 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />
                {props.search && (
                    <button
                        type="button"
                        onClick={() => props.onSearch('')}
                        aria-label={t('common.clearSearch')}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg"
                    >
                        <X size={13} aria-hidden />
                    </button>
                )}
            </div>

            {props.sort && props.onSort && (
                <label className="flex items-center gap-1.5 text-xs text-fg-soft">
                    {t('browser.sort.label')}
                    <select
                        value={props.sort}
                        onChange={e => props.onSort?.(e.target.value as SortMode)}
                        className="rounded border border-default bg-surface-sunken px-1.5 py-1 text-xs text-fg outline-none focus:border-[var(--emphasis)]"
                    >
                        {SORTS.map(sort => (
                            <option key={sort.id} value={sort.id}>
                                {t(sort.labelKey)}
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
                {t('browser.reverse')}
            </label>

            {props.children}

            <div className="flex-1" />

            <span className="text-xs text-fg-soft tabular-nums">
                {props.count === props.total
                    ? props.total
                    : t('browser.countOf', { count: props.count, total: props.total })}
            </span>

            <div className="flex rounded border border-default overflow-hidden">
                <ViewButton
                    active={props.view === 'grid'}
                    label={t('view.grid')}
                    onClick={() => props.onView('grid')}
                >
                    <Grid3x3 size={14} aria-hidden />
                </ViewButton>
                <ViewButton
                    active={props.view === 'list'}
                    label={t('view.list')}
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

/** Star toggle for one browsed entry, shared by every browser that has starring.
 *
 * `overlay` rides on top of a preview image and stays out of the way until the entry is hovered;
 * `plain` sits inline in a list row. Either way a starred entry keeps the star lit and on screen,
 * because starred is the state worth seeing without hunting for it. */
export function StarButton(props: {
    starred: boolean;
    variant: 'overlay' | 'plain';
    onClick: () => void;
}) {
    const label = props.starred ? translate('common.unstar') : translate('common.star');
    const overlay = props.variant === 'overlay';
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={label}
            aria-pressed={props.starred}
            title={label}
            className={[
                'rounded-full p-1 transition-[color,opacity]',
                overlay ? 'bg-black/60' : 'hover:bg-[var(--sw-hover)]',
                props.starred
                    ? ''
                    : overlay
                        ? 'text-white/80 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                        : 'text-fg-soft hover:text-fg'
            ].join(' ')}
            style={props.starred ? { color: 'var(--star)' } : undefined}
        >
            <Star size={overlay ? 13 : 14} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
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
