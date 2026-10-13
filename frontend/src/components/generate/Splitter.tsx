import { useCallback, useEffect, useRef } from 'react';

/** Draggable vertical divider between two panes. Also resizable from the keyboard, via the arrow
 *  keys on the focused handle. */
export function Splitter(props: {
    onResize: (deltaPx: number) => void;
    label: string;
    /** Which side grows when the value increases. */
    invert?: boolean;
}) {
    const lastX = useRef<number | null>(null);
    /** Ends a drag, however it ended - released, cancelled by the browser, or cut short by the
     *  handle unmounting - so the page is never left unselectable with a resize cursor. */
    const endDrag = useCallback(() => {
        if (lastX.current === null) {
            return;
        }
        lastX.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    useEffect(() => endDrag, [endDrag]);

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={props.label}
            tabIndex={0}
            onPointerDown={e => {
                if (e.button !== 0) {
                    return;
                }
                // Capture keeps the move/up events coming to this handle even when the pointer
                // leaves it - over an iframe, or outside the window - so no global listeners.
                e.currentTarget.setPointerCapture(e.pointerId);
                lastX.current = e.clientX;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            }}
            onPointerMove={e => {
                if (lastX.current === null) {
                    return;
                }
                const delta = e.clientX - lastX.current;
                lastX.current = e.clientX;
                props.onResize(props.invert ? -delta : delta);
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={e => {
                const step = e.shiftKey ? 40 : 12;
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    props.onResize(props.invert ? step : -step);
                }
                else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    props.onResize(props.invert ? -step : step);
                }
            }}
            className="group relative w-1 shrink-0 touch-none cursor-col-resize bg-transparent hover:bg-[var(--emphasis-soft)] focus-visible:bg-[var(--emphasis)]"
        >
            <span className="absolute inset-y-0 -left-1 -right-1" />
        </div>
    );
}
