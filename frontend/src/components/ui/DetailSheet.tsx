import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsCompact } from '@/shell/viewport';
import { useTranslation } from '@/i18n';

/** The detail panel every browser opens for a selected entry.
 *
 * On a wide screen it is a column beside the list, which keeps the list visible while you read the
 * detail. On a narrow one that column would leave the list about 90px wide, so it becomes a bottom
 * sheet instead: portrait screens have vertical room to spare and no horizontal room at all, and a
 * sheet rising from the bottom edge also puts its content within thumb reach.
 *
 * Callers write one tree — a header block and a scrolling body — and this decides how it is
 * presented. `min-h-0` on the body is the caller's job either way, exactly as with the old
 * hand-rolled `<aside>`s this replaces. */
export function DetailSheet(props: {
    /** Accessible name for the panel. */
    label: string;
    onClose: () => void;
    /** Width utility for the desktop column. Ignored by the bottom sheet, which is full-width. */
    width?: string;
    style?: CSSProperties;
    children: ReactNode;
}) {
    const { t } = useTranslation();
    const compact = useIsCompact();
    const { onClose } = props;

    // Escape closes, matching every other overlay in this UI.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    if (!compact) {
        return (
            <aside
                aria-label={props.label}
                className={[props.width ?? 'w-96', 'flex shrink-0 flex-col border-l border-subtle bg-surface'].join(' ')}
                style={props.style}
            >
                {props.children}
            </aside>
        );
    }

    // Portalled so the sheet is positioned against the viewport rather than against whichever
    // browser pane happens to be its parent, several nested `overflow-hidden` containers down.
    return createPortal(
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
            <button
                type="button"
                aria-label={t('common.close')}
                onClick={onClose}
                className="min-h-12 flex-1 bg-black/50"
            />
            <aside
                aria-label={props.label}
                className="flex max-h-[85svh] flex-col rounded-t-lg border-t border-default bg-surface shadow-2xl"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)', ...props.style }}
            >
                {/* The grab bar reads as "this panel came up from the bottom and goes back down",
                    which the top-right X alone does not. */}
                <span
                    aria-hidden
                    className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full opacity-40"
                    style={{ background: 'var(--sw-fg-soft)' }}
                />
                {props.children}
            </aside>
        </div>,
        document.body
    );
}
