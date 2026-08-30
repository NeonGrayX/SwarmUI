import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** How far the pointer travels for one step of the value. Matches the legacy UI's stepDist. */
const STEP_DISTANCE = 10;

/** Drag-to-adjust for a number box, the way every number input in the legacy UI behaved
 *  (UIImprovementHandler in src/wwwroot/js/genpage/helpers/ui_improvements.js): press on the box and
 *  drag right or up to raise the value, left or down to lower it, one step per ten pixels.
 *
 *  The drag only takes over once the pointer has moved that far, so a press that goes nowhere is
 *  still an ordinary click into the box. Only mouse and pen do it at all: on a touchscreen the
 *  same gesture scrolls the page, and a box this small is no place to take that over.
 *
 *  Returns props to spread onto the `<input type="number">`. */
export function useNumberDrag(options: {
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    /** How much one step of the drag moves the value. */
    step?: number;
}) {
    const { value, onChange, min, max, step = 1 } = options;
    /** Where the press landed and what the value was then, for the length of one drag. */
    const origin = useRef<{ pointer: number; x: number; y: number; value: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    function end(): void {
        origin.current = null;
        setDragging(false);
    }

    return {
        onPointerDown(e: ReactPointerEvent<HTMLInputElement>): void {
            if (e.button === 0 && e.pointerType !== 'touch') {
                origin.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, value };
            }
        },
        onPointerMove(e: ReactPointerEvent<HTMLInputElement>): void {
            const from = origin.current;
            if (!from || from.pointer !== e.pointerId) {
                return;
            }
            // Truncating rather than rounding is what makes the first ten pixels a dead zone: below
            // that the press is still just a click. Both axes count, so a drag that wanders up or
            // down off the box keeps adjusting.
            const steps = Math.trunc((e.clientX - from.x) / STEP_DISTANCE)
                - Math.trunc((e.clientY - from.y) / STEP_DISTANCE);
            if (steps === 0 && !dragging) {
                return;
            }
            if (!dragging) {
                setDragging(true);
                // Captured from here on, so the value keeps following a pointer that has left the
                // box - which it will, since ten pixels is most of the way across it.
                e.currentTarget.setPointerCapture(e.pointerId);
            }
            // Counted from where the press landed rather than from the live value, so the pointer
            // and the value stay in lockstep: dragging back to the start restores what was there,
            // and a drag past the ends does not lose its place against the clamp.
            onChange(Math.min(max, Math.max(min, from.value + steps * step)));
            e.preventDefault();
        },
        onPointerUp: end,
        onPointerCancel: end,
        style: dragging ? { cursor: 'ew-resize' } : undefined
    };
}
