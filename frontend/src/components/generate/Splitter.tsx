import { useCallback, useEffect, useRef } from 'react';

/** Draggable vertical divider between two panes.
 *
 * Keyboard accessible, which the legacy `.splitter-bar` divs are not - they are plain divs with
 * mousedown handlers and no role, tabindex or key handling. */
export function Splitter(props: {
    onResize: (deltaPx: number) => void;
    label: string;
    /** Which side grows when the value increases. */
    invert?: boolean;
}) {
    const dragging = useRef(false);
    const lastX = useRef(0);

    const onPointerMove = useCallback(
        (e: PointerEvent) => {
            if (!dragging.current) {
                return;
            }
            const delta = e.clientX - lastX.current;
            lastX.current = e.clientX;
            props.onResize(props.invert ? -delta : delta);
        },
        [props]
    );

    const onPointerUp = useCallback(() => {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    useEffect(() => {
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };
    }, [onPointerMove, onPointerUp]);

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={props.label}
            tabIndex={0}
            onPointerDown={e => {
                dragging.current = true;
                lastX.current = e.clientX;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            }}
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
            className="group relative w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-[var(--emphasis-soft)] focus-visible:bg-[var(--emphasis)]"
        >
            <span className="absolute inset-y-0 -left-1 -right-1" />
        </div>
    );
}
