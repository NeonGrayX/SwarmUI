/** Drawing a long list a screenful at a time.
 *
 * The listing routes answer with one flat array - ListModels and ListImages have no page
 * parameter - and a model folder or an output folder is routinely thousands of entries. Handing
 * all of that to React at once costs a visible pause before the first row appears, and every
 * later render pays for rows nobody has scrolled to.
 *
 * So this draws the first `step` entries and adds another `step` whenever the end of the list is
 * scrolled into view. Nothing else changes: the caller still holds the whole array, and selection,
 * search and keyboard stepping all still run over it, because those are about the listing rather
 * than about what is currently painted.
 */

import { useEffect, useMemo, useState } from 'react';

export interface Incremental<T> {
    /** The prefix of `items` to render. */
    visible: T[];
    /** Ref for an element placed after the last row; scrolling it into view draws more. Null once
     *  everything is drawn, which is the signal not to render the element at all. */
    endRef: ((node: HTMLElement | null) => void) | null;
}

/** `resetKey` names the listing: drawing starts over from the top only when it changes - another
 *  folder, another search, another sort. Without one, every new `items` array counts as a new
 *  listing, so `items` must then be memoized or every render would restart the list at `step`.
 *
 *  With a key, a new array under the same key - a star toggled, an entry deleted, a background
 *  refetch - keeps everything already drawn, so the page does not jump back to the top under the
 *  user's scroll position. */
export function useIncremental<T>(items: T[], step = 120, resetKey?: unknown): Incremental<T> {
    const [count, setCount] = useState(step);
    const [end, setEnd] = useState<HTMLElement | null>(null);

    // Reset during render rather than in an effect, so the frame after a folder change never
    // paints the old count against the new listing.
    const key = resetKey === undefined ? items : resetKey;
    const [seenKey, setSeenKey] = useState<unknown>(key);
    const [seenStep, setSeenStep] = useState(step);
    if (!Object.is(seenKey, key) || seenStep !== step) {
        setSeenKey(key);
        setSeenStep(step);
        setCount(step);
    }

    const complete = count >= items.length;

    useEffect(() => {
        if (!end || complete) {
            return undefined;
        }
        // Re-observing after each growth is what lets a list shorter than its container fill
        // itself: the sentinel is still on screen, so the observer fires again straight away.
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setCount(current => current + step);
            }
        });
        observer.observe(end);
        return () => observer.disconnect();
    }, [end, complete, step]);

    const visible = useMemo(() => (complete ? items : items.slice(0, count)), [items, count, complete]);

    return { visible, endRef: complete ? null : setEnd };
}
