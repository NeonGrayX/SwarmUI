import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/shell/viewport';

/** An in-page navigation column — folder tree, settings groups, account list — that folds into a
 *  single disclosure row on phones.
 *
 *  A 14rem column costs a third of a 360px screen before any content is drawn, and it is nav for
 *  content that is itself the point of the screen. Collapsed, it costs one row and still answers
 *  "where am I", because `summary` shows the current selection. Picking something closes it again:
 *  on a phone the panel covers what it is navigating, so leaving it open after a choice hides the
 *  result of that choice.
 *
 *  Children are a function of `close` rather than plain nodes so callers can wire that up without
 *  a context; on desktop `close` is a no-op and the column never collapses. */
export function SideNav(props: {
    /** Accessible name for the nav landmark. */
    label: string;
    /** What is selected right now, shown on the collapsed row. */
    summary: ReactNode;
    /** Desktop column width class. */
    width?: string;
    children: (close: () => void) => ReactNode;
}) {
    const mobile = useIsMobile();
    const [open, setOpen] = useState(false);

    if (!mobile) {
        return (
            <nav
                aria-label={props.label}
                className={[props.width ?? 'w-56', 'shrink-0 overflow-y-auto border-r border-subtle p-2'].join(' ')}
            >
                {props.children(() => {})}
            </nav>
        );
    }

    return (
        <div className="shrink-0 border-b border-subtle bg-surface">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-fg-soft hover:text-fg"
            >
                {open ? (
                    <ChevronDown size={14} className="shrink-0" aria-hidden />
                ) : (
                    <ChevronRight size={14} className="shrink-0" aria-hidden />
                )}
                <span className="shrink-0 text-xs uppercase tracking-wide">{props.label}</span>
                <span className="min-w-0 flex-1 truncate text-fg-strong">{props.summary}</span>
            </button>
            {open && (
                <nav
                    aria-label={props.label}
                    className="max-h-[45svh] overflow-y-auto border-t border-subtle p-2"
                >
                    {props.children(() => setOpen(false))}
                </nav>
            )}
        </div>
    );
}
