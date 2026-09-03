/** Viewport-class detection for the layout decisions CSS alone cannot express.
 *
 * Most responsive work in this UI is plain Tailwind breakpoint classes. These hooks exist for the
 * cases where a narrow screen needs a *different component tree*, not a different set of rules:
 * a side sheet that becomes a portalled bottom sheet, a rail that becomes a drawer, three panes
 * that become three tabs. Rendering both trees and hiding one with `hidden` would double the
 * subscriptions behind them (the batch rail, the parameter schema, the folder tree), so the choice
 * has to happen in JS.
 *
 * The two thresholds line up exactly with Tailwind's own `md` (48rem) and `lg` (64rem), so a
 * component can mix `useIsMobile()` with `md:` classes and the two always agree.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** Below this, there is no room for two content panes side by side. Matches Tailwind `lg`. */
export const COMPACT_QUERY = '(max-width: 1023px)';
/** Below this, there is no room for persistent navigation chrome either. Matches Tailwind `md`. */
export const MOBILE_QUERY = '(max-width: 767px)';

/** One MediaQueryList per query, shared by every subscriber, so a screen full of Fields does not
 *  allocate a listener each. */
const lists = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null;
    }
    let list = lists.get(query);
    if (!list) {
        list = window.matchMedia(query);
        lists.set(query, list);
    }
    return list;
}

/** Live `matchMedia` result. Re-renders the caller when the match flips. */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const list = listFor(query);
            if (!list) {
                return () => {};
            }
            list.addEventListener('change', onChange);
            return () => list.removeEventListener('change', onChange);
        },
        [query]
    );
    const snapshot = useCallback(() => listFor(query)?.matches ?? false, [query]);
    // The server snapshot is the desktop layout: it is the one that renders correctly at any width,
    // just not the one that is nicest below 1024px.
    return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** True when side-by-side content panes no longer fit — phones and portrait tablets. */
export function useIsCompact(): boolean {
    return useMediaQuery(COMPACT_QUERY);
}

/** True on phone-width screens, where even the navigation rail has to fold away. */
export function useIsMobile(): boolean {
    return useMediaQuery(MOBILE_QUERY);
}

/** The slice of the layout viewport that is actually on screen, in CSS pixels.
 *
 * An on-screen keyboard shrinks the *visual* viewport and leaves the layout viewport — the thing
 * `position: fixed` is measured against — at its full height. So an overlay pinned to `inset-0`
 * runs on behind the keyboard, and half of it is simply not there to be read or tapped. These are
 * the numbers needed to pin an overlay to what the user can see instead. */
export interface VisibleViewport {
    /** Distance from the top of the layout viewport to the top of the visible band. */
    top: number;
    /** Height of the visible band. */
    height: number;
}

/** Cached so `useSyncExternalStore` sees a stable reference between resizes, rather than a fresh
 *  object on every read - which it would treat as a change and re-render on forever. */
let visibleViewport: VisibleViewport = { top: 0, height: 0 };

function readVisibleViewport(): VisibleViewport {
    if (typeof window === 'undefined') {
        return visibleViewport;
    }
    const view = window.visualViewport;
    const top = view?.offsetTop ?? 0;
    const height = view?.height ?? window.innerHeight;
    if (top !== visibleViewport.top || height !== visibleViewport.height) {
        visibleViewport = { top, height };
    }
    return visibleViewport;
}

function subscribeVisibleViewport(onChange: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => {};
    }
    // The band moves on scroll as well as on resize: the browser scrolls the visual viewport to
    // keep a focused field above the keyboard, which changes `offsetTop` without changing height.
    const view = window.visualViewport;
    if (!view) {
        window.addEventListener('resize', onChange);
        return () => window.removeEventListener('resize', onChange);
    }
    view.addEventListener('resize', onChange);
    view.addEventListener('scroll', onChange);
    return () => {
        view.removeEventListener('resize', onChange);
        view.removeEventListener('scroll', onChange);
    };
}

/** Live visible band. Re-renders the caller when the keyboard opens, closes, or scrolls the page
 *  under itself. */
export function useVisibleViewport(): VisibleViewport {
    return useSyncExternalStore(subscribeVisibleViewport, readVisibleViewport, readVisibleViewport);
}
