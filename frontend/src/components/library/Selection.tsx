import { useEffect, useMemo, useState } from 'react';

/** Multi-selection shared by every Library browser.
 *
 * The legacy browsers can only act on one entry at a time, so deleting a run of images means
 * repeating the same confirm dialog per file. Selection here works the way a file manager's does:
 * a checkbox that appears on hover, modifier-click to take a whole run, and the actions that can
 * apply to many entries gathered in one bar above the list. */
export interface Selection {
    /** Ids in list order, so bulk actions run top-to-bottom rather than in insertion order. */
    readonly ids: string[];
    readonly count: number;
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    /** Opens the entry on a plain click, extends the selection on a modifier-click. */
    click: (event: React.MouseEvent, id: string, onOpen: () => void) => void;
    selectAll: () => void;
    clear: () => void;
}

/** `ids` is every entry currently on screen, in the order it is drawn. Memoize it - it defines
 *  what a range covers and what "select all" means. */
export function useSelection(ids: string[]): Selection {
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
    // Where the next range starts: the last entry checked or range-clicked.
    const [anchor, setAnchor] = useState<string | null>(null);

    // Changing folder or narrowing the search drops entries that went away, so a bulk action can
    // never reach something that is no longer on screen.
    useEffect(() => {
        setSelected(current => {
            if (current.size === 0) {
                return current;
            }
            const present = new Set(ids.filter(id => current.has(id)));
            return present.size === current.size ? current : present;
        });
    }, [ids]);

    const selectedIds = useMemo(() => ids.filter(id => selected.has(id)), [ids, selected]);

    function toggle(id: string): void {
        setSelected(current => {
            const next = new Set(current);
            if (!next.delete(id)) {
                next.add(id);
            }
            return next;
        });
        setAnchor(id);
    }

    /** Adds everything from the anchor to `id`, both ends included. */
    function extendTo(id: string): void {
        const to = ids.indexOf(id);
        if (to < 0) {
            return;
        }
        const from = anchor === null ? -1 : ids.indexOf(anchor);
        // Without an anchor - or with one that has since scrolled out of the list - the range is
        // just the clicked entry, which then becomes the anchor for the next one.
        const [start, end] = from < 0 ? [to, to] : from <= to ? [from, to] : [to, from];
        setSelected(current => new Set([...current, ...ids.slice(start, end + 1)]));
        if (from < 0) {
            setAnchor(id);
        }
    }

    return {
        ids: selectedIds,
        count: selectedIds.length,
        isSelected: id => selected.has(id),
        toggle,
        click: (event, id, onOpen) => {
            // Ctrl (Cmd on macOS) is what the request asked for; Shift is what a file manager
            // trains people to reach for. Both take the range.
            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                event.preventDefault();
                extendTo(id);
                return;
            }
            onOpen();
        },
        selectAll: () => setSelected(new Set(ids)),
        clear: () => {
            setSelected(new Set<string>());
            setAnchor(null);
        }
    };
}

/** The per-entry checkbox. Hidden until the entry is hovered or focused, unless it is checked -
 *  a selection you cannot see while the pointer is elsewhere is a selection you delete by
 *  accident. Expects an ancestor marked `group`. */
export function SelectionCheckbox(props: {
    checked: boolean;
    onToggle: () => void;
    label: string;
    /** Sits over a preview image rather than a surface, so it needs its own backdrop. */
    overlay?: boolean;
}) {
    return (
        <span
            className={[
                'flex items-center rounded transition-opacity',
                props.overlay ? 'bg-black/60 p-0.5' : '',
                props.checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            ].join(' ')}
        >
            <input
                type="checkbox"
                checked={props.checked}
                // The entry itself opens on click; the checkbox must not also do that.
                onClick={event => event.stopPropagation()}
                onChange={props.onToggle}
                aria-label={props.label}
                title={props.label}
                className="block cursor-pointer accent-[var(--emphasis)]"
            />
        </span>
    );
}

/** Bulk action bar, shown above the list while anything is selected. Actions go in `children`
 *  because what can be done to many entries at once differs per browser. */
export function SelectionBar(props: {
    count: number;
    total: number;
    onSelectAll: () => void;
    onClear: () => void;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle bg-surface-sunken px-3 py-1.5">
            <span className="text-xs text-fg-strong tabular-nums">{props.count} selected</span>
            {props.count < props.total && (
                <SelectionButton label={`Select all ${props.total}`} onClick={props.onSelectAll} />
            )}
            <SelectionButton label="Clear" onClick={props.onClear} />

            <div className="flex-1" />

            {props.children}
        </div>
    );
}

export function SelectionButton(props: {
    label: string;
    onClick: () => void;
    destructive?: boolean;
    disabled?: boolean;
    children?: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            className="flex items-center gap-1 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent"
            style={props.destructive ? { color: 'var(--backend-errored)' } : undefined}
        >
            {props.children}
            {props.label}
        </button>
    );
}
