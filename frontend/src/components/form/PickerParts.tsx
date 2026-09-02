import type { MouseEvent } from 'react';
import { Command } from 'cmdk';
import { Check, Grid3x3, ImageOff, List, Search, Star, X } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LongPressHandlers } from '@/components/ui/ContextMenu';
import type { ViewMode } from '@/library/types';
import { t as translate, useTranslation } from '@/i18n';

/** The parts every "pick one from a big library" dropdown is built from: the search box, the
 *  grid/list switch, the filter chips above the list, and the two shapes an entry takes in each of
 *  the two views.
 *
 * The model pickers are what these were drawn for, and the Simple workspace's workflow dropdown
 * reuses them so that choosing a workflow works the way choosing a model does. Which filters a
 * picker offers and what its entries carry are passed in as slots; the chip and the star are here
 * because they are the same control wherever they appear.
 */

/** How a picker was left last time: grid or list, and whether it was down to starred entries
 *  only. */
export interface PickerPrefs {
    view: ViewMode;
    starredOnly: boolean;
    setView: (view: ViewMode) => void;
    setStarredOnly: (on: boolean) => void;
}

/** One persisted store per name, made on first use.
 *
 * Each picker remembers its own view and filter - the model pickers already did, and a picker that
 * reset to thumbnails every time it opened would undo a choice the user made on purpose. The store
 * has to outlive the component for that, so it is made once here and kept, rather than created in
 * a render. */
const prefsStores = new Map<string, () => PickerPrefs>();

/** The remembered preferences of the picker stored under `name`. `name` is the localStorage key and
 *  must be constant for a given picker, the way any hook's identity must be. */
export function usePickerPrefs(name: string): PickerPrefs {
    let store = prefsStores.get(name);
    if (!store) {
        store = create<PickerPrefs>()(
            persist(
                set => ({
                    view: 'grid',
                    starredOnly: false,
                    setView: view => set({ view }),
                    setStarredOnly: starredOnly => set({ starredOnly })
                }),
                { name }
            )
        );
        prefsStores.set(name, store);
    }
    return store();
}

/** Search field with a clear button, sitting above a `Command.List`. */
export function PickerSearch(props: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
}) {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
            />
            <Command.Input
                value={props.value}
                onValueChange={props.onChange}
                placeholder={props.placeholder}
                className="w-full rounded border border-default bg-surface-sunken py-1.5 pl-7 pr-7 text-sm text-fg outline-none focus:border-[var(--emphasis)] placeholder:text-fg-soft"
            />
            {props.value && (
                <button
                    type="button"
                    onClick={() => props.onChange('')}
                    aria-label={t('common.clearSearch')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                >
                    <X size={13} aria-hidden />
                </button>
            )}
        </div>
    );
}

/** Thumbnails or rows: the same choice in every picker, so it is remembered per picker rather
 *  than reset on each opening. */
export function PickerViewToggle(props: { view: ViewMode; onView: (view: ViewMode) => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex overflow-hidden rounded border border-default">
            {(
                [
                    ['grid', Grid3x3, 'view.grid'],
                    ['list', List, 'view.list']
                ] as const
            ).map(([mode, Icon, labelKey]) => (
                <button
                    key={mode}
                    type="button"
                    onClick={() => props.onView(mode)}
                    aria-pressed={props.view === mode}
                    aria-label={t(labelKey)}
                    title={t(labelKey)}
                    className={[
                        'p-1 transition-colors',
                        props.view === mode
                            ? 'bg-[var(--sw-active)] text-fg-strong'
                            : 'text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
                    ].join(' ')}
                >
                    <Icon size={13} aria-hidden />
                </button>
            ))}
        </div>
    );
}

/** One filter above a picker's list, drawn as a chip that lights up while its filter is on. */
export function PickerChip(props: {
    pressed: boolean;
    label: string;
    title?: string;
    onToggle: () => void;
    /** Leading icon, where the filter has one worth showing. */
    children?: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onToggle}
            aria-pressed={props.pressed}
            title={props.title}
            className={[
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                props.pressed
                    ? 'border-transparent bg-[var(--emphasis)] text-[var(--sw-accent-fg)]'
                    : 'border-default text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
            ].join(' ')}
        >
            {props.children}
            {props.label}
        </button>
    );
}

/** Star toggle for one entry of a picker, for the `actions` slot below.
 *
 * `overlay` rides on a card's thumbnail and stays out of the way until the card is hovered; the
 * plain form sits at the end of a row. A starred entry keeps its star lit either way. Omitting
 * `onStar` draws nothing, for pickers whose entries cannot all be starred. */
export function PickerStar(props: { starred: boolean; onStar?: () => void; overlay?: boolean }) {
    if (!props.onStar) {
        return null;
    }
    const label = props.starred ? translate('common.unstar') : translate('common.star');
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={props.starred}
            title={label}
            onClick={event => {
                // The row itself is the pick action, so starring must not also select the entry.
                event.stopPropagation();
                event.preventDefault();
                props.onStar?.();
            }}
            className={[
                'shrink-0 rounded-full p-1 transition-[color,opacity]',
                props.overlay ? 'bg-black/60' : 'hover:bg-[var(--sw-hover)]',
                props.starred
                    ? ''
                    : props.overlay
                      ? 'text-white/80 opacity-0 hover:text-white focus-visible:opacity-100 group-hover:opacity-100'
                      : 'text-fg-soft hover:text-fg'
            ].join(' ')}
            style={props.starred ? { color: 'var(--star)' } : undefined}
        >
            <Star size={11} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
        </button>
    );
}

/** Holds the entries, laying them out as a grid of cards or a column of rows. */
export function PickerGroup(props: { view: ViewMode; children: React.ReactNode }) {
    return (
        <Command.Group
            className={
                props.view === 'grid'
                    ? '[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] [&_[cmdk-group-items]]:gap-2'
                    : ''
            }
        >
            {props.children}
        </Command.Group>
    );
}

/** Preview image, or a neutral placeholder so rows keep a stable rhythm. */
export function PickerThumb(props: { preview: string | undefined; size: 'xs' | 'sm' }) {
    const side = props.size === 'xs' ? 'size-5' : 'size-7';
    return (
        <span className={`${side} shrink-0 overflow-hidden rounded bg-surface-sunken`}>
            {props.preview && (
                <img src={props.preview} alt="" loading="lazy" className="h-full w-full object-cover" />
            )}
        </span>
    );
}

interface EntryProps {
    /** What cmdk keys the entry by, and what its keyboard selection reports. */
    value: string;
    title: string;
    /** Second line: where the entry came from, usually its folder. */
    subtitle?: string | null;
    preview?: string;
    picked: boolean;
    tooltip?: string;
    onPick: () => void;
    /** Corner mark over the thumbnail in grid view, eg a compat family badge. Supplies its own
     *  colours, since what a badge means differs by picker. */
    badge?: React.ReactNode;
    /** Beside the picked check, top-left of a card. */
    marks?: React.ReactNode;
    /** Top-right of a card, and the end of a row: actions on the entry itself. */
    actions?: React.ReactNode;
    /** End of a row, before the actions. */
    trailing?: React.ReactNode;
    /** Border colouring for a card that is listed but cannot be used. */
    highlighted?: boolean;
    /** Opens the entry's right-click menu, where the picker offers one. */
    onContextMenu?: (event: MouseEvent) => void;
    /** The long-press equivalent, from the same menu, for touch screens. */
    longPress?: LongPressHandlers;
}

export function PickerCard(props: EntryProps) {
    return (
        <Command.Item
            value={props.value}
            onSelect={props.onPick}
            title={props.tooltip}
            onContextMenu={props.onContextMenu}
            {...props.longPress}
            className={[
                'group relative cursor-pointer overflow-hidden rounded-lg border bg-surface text-left',
                'data-[selected=true]:border-[var(--emphasis)]',
                props.picked || props.highlighted ? 'border-[var(--emphasis)]' : 'border-default'
            ].join(' ')}
        >
            <div className="relative flex aspect-square items-center justify-center bg-surface-sunken">
                {props.preview ? (
                    <img src={props.preview} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                    <ImageOff size={20} aria-hidden className="text-fg-soft opacity-40" />
                )}
                {props.badge}
            </div>
            <div className="p-1.5">
                <p className="truncate text-xs text-fg-strong">{props.title}</p>
                <p className="truncate text-[10px] text-fg-soft">{props.subtitle || ' '}</p>
            </div>
            <div className="absolute left-1 top-1 flex items-center gap-1">
                {props.picked && (
                    <span className="rounded-full bg-[var(--emphasis)] p-0.5 text-[var(--sw-accent-fg)]">
                        <Check size={11} aria-hidden />
                    </span>
                )}
                {props.marks}
            </div>
            <div className="absolute right-1 top-1 flex items-center gap-1">{props.actions}</div>
        </Command.Item>
    );
}

export function PickerRow(props: EntryProps) {
    return (
        <Command.Item
            value={props.value}
            onSelect={props.onPick}
            title={props.tooltip}
            onContextMenu={props.onContextMenu}
            {...props.longPress}
            className="group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 data-[selected=true]:bg-[var(--sw-active)]"
        >
            <PickerThumb preview={props.preview} size="sm" />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                    {props.picked && <Check size={12} aria-hidden className="shrink-0 text-[var(--emphasis)]" />}
                    <span className="truncate text-sm text-fg">{props.title}</span>
                </span>
                {props.subtitle && (
                    <span className="block truncate text-[11px] text-fg-soft">{props.subtitle}</span>
                )}
            </span>
            {props.trailing}
            {props.actions}
        </Command.Item>
    );
}
