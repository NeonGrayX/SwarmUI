/** View state shared by the canvas and the batch rail: the full-screen viewer, the compare view,
 *  and stepping through the batch.
 *
 * The rail and the canvas are separate trees (on a narrow screen, separate tabs), so what one opens
 * the other has to be able to see. Kept apart from the generation store, which owns the run itself. */

import { create } from 'zustand';
import { useGenerateStore } from '@/generate/store';
import type { BatchItem } from '@/generate/types';

/** One side of a comparison. */
export interface CompareImage {
    /** Resolved URL (imageUrl). */
    url: string;
    metadata?: string | null;
    label: string;
}

interface BatchViewStore {
    /** Slot shown in the full-screen viewer, or null when it is closed. Tracked apart from the
     *  canvas selection, so a new image arriving need not yank the viewer along with it
     *  (the AutoSwapImagesIncludesFullView setting). */
    viewing: string | null;
    /** Left and right of the compare view, or null when it is closed. */
    compare: { left: CompareImage; right: CompareImage | null } | null;
    setViewing: (id: string | null) => void;
    openCompare: (left: CompareImage, right?: CompareImage | null) => void;
    setCompareRight: (right: CompareImage | null) => void;
    swapCompare: () => void;
    closeCompare: () => void;
}

export const useBatchViewStore = create<BatchViewStore>(set => ({
    viewing: null,
    compare: null,
    setViewing: id => set({ viewing: id }),
    openCompare: (left, right = null) => set({ compare: { left, right } }),
    setCompareRight: right => set(s => (s.compare ? { compare: { ...s.compare, right } } : {})),
    swapCompare: () =>
        set(s => (s.compare?.right ? { compare: { left: s.compare.right, right: s.compare.left } } : {})),
    closeCompare: () => set({ compare: null })
}));

/** Slots that have something to show, in rail order - what stepping walks through. Placeholders
 *  with no preview yet are skipped, as the legacy UI skips them. */
export function navigableItems(batch: BatchItem[]): BatchItem[] {
    return batch.filter(item => item.status !== 'discarded' && Boolean(item.src));
}

/** Ids of the navigable slots, for a shallow-compared selector. */
export function navigableIds(batch: BatchItem[]): string[] {
    return navigableItems(batch).map(item => item.id);
}

/** The id `delta` steps from `id` through `ids`, wrapping at the ends when `cycle` is set, or
 *  null when there is nowhere to go. */
export function stepId(ids: string[], id: string | null, delta: number, cycle: boolean): string | null {
    if (ids.length === 0) {
        return null;
    }
    const index = id === null ? -1 : ids.indexOf(id);
    if (index === -1) {
        return ids[delta > 0 ? 0 : ids.length - 1];
    }
    let next = index + delta;
    if (next < 0 || next >= ids.length) {
        if (!cycle) {
            return null;
        }
        next = (next + ids.length) % ids.length;
    }
    return next === index ? null : ids[next];
}

/** Whether a `ui.imageshiftingcycles` value allows wrapping, for a shift by arrow key or not. */
export function shiftCycles(setting: string, isArrows: boolean): boolean {
    return setting === 'true' || (isArrows && setting === 'only_arrows');
}

/** Moves the canvas, and the viewer if it is open, `delta` slots along the batch. Returns whether
 *  there was anywhere to go. */
export function stepBatch(delta: number, cycle: boolean): boolean {
    const state = useGenerateStore.getState();
    const view = useBatchViewStore.getState();
    const next = stepId(navigableIds(state.batch), view.viewing ?? state.selected, delta, cycle);
    if (!next) {
        return false;
    }
    state.select(next);
    if (view.viewing !== null) {
        view.setViewing(next);
    }
    return true;
}

/** Drops a slot from the rail. When it was the one on the canvas, `next` (or nothing) takes its
 *  place, and the viewer follows. */
export function removeBatchItem(id: string, next: string | null): void {
    useGenerateStore.getState().removeItem(id, next);
    const view = useBatchViewStore.getState();
    if (view.viewing === id) {
        view.setViewing(next);
    }
}
