import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown, Grid3x3, ImageOff, List, Search, Star, X } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LongPressHandlers } from '@/components/ui/ContextMenu';
import type { ViewMode } from '@/library/types';
import { useIsMobile, useVisibleViewport } from '@/shell/viewport';
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

/** What a picker's list needs of the surface it opens onto, whichever shape that surface takes. */
interface PickerSurfaceProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Names the list for screen readers, and titles the sheet on a phone. */
    label: string;
    /** The control the list belongs to, rendered as the trigger either way. */
    trigger: ReactNode;
    /** Lets a caller keep the list open through a click that belongs to a popup of its own. */
    onInteractOutside?: (event: Event) => void;
    children: ReactNode;
}

/** The surface a picker's list opens onto.
 *
 * On a wide screen that is a popover anchored to the trigger, capped to the room Radix measured
 * for it, so a list that opens upwards stops at the top of the window instead of running past it.
 *
 * A phone gets a sheet over the whole visible area instead. An anchored popover cannot work there:
 * opening one focuses its search box, the on-screen keyboard then takes half the screen, and the
 * list is asked to fit into whatever is left beside a trigger that may itself be low on the page -
 * which is nothing, so it was drawn off the top of the screen with its search box out of reach.
 */
export function PickerPopover(props: PickerSurfaceProps) {
    // Two component trees rather than one with two branches, so the desktop one never subscribes
    // to the visual viewport it has no use for.
    return useIsMobile() ? <PickerSheet {...props} /> : <PickerAnchored {...props} />;
}

/** The wide-screen shape: a popover hanging off the trigger. */
function PickerAnchored(props: PickerSurfaceProps) {
    return (
        <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                    aria-label={props.label}
                    onInteractOutside={props.onInteractOutside}
                    // Radix publishes the height it found room for; without the cap the list keeps
                    // its natural height and simply overflows the edge of the window.
                    style={{ maxHeight: 'var(--radix-popover-content-available-height)' }}
                    className="z-50 flex w-[min(28rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl"
                >
                    {props.children}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** The phone shape: a sheet filling the part of the window the keyboard is not sitting on.
 *
 * Only the frame re-renders when that area changes - `children` arrives as the same element it did
 * last time, which is React's cue to leave the list below it alone. */
function PickerSheet(props: PickerSurfaceProps) {
    const { t } = useTranslation();
    const visible = useVisibleViewport();

    return (
        // Non-modal, which is what the popover this replaces was: a picker's right-click menu
        // portals out beside this content, and a modal dialog would make it untappable.
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange} modal={false}>
            <Dialog.Trigger asChild>{props.trigger}</Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Content
                    aria-describedby={undefined}
                    onInteractOutside={props.onInteractOutside}
                    className="fixed inset-x-0 z-50 flex flex-col bg-surface-raised shadow-2xl"
                    style={{
                        top: visible.top,
                        height: visible.height,
                        paddingBottom: 'env(safe-area-inset-bottom)'
                    }}
                >
                    <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-2">
                        <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong">
                            {props.label}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={t('common.close')}
                                className="rounded p-1 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                            >
                                <X size={16} aria-hidden />
                            </button>
                        </Dialog.Close>
                    </div>
                    {props.children}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** The control a library dropdown hangs off: a preview of the current entry where there is one,
 *  that entry's name or the dropdown's own, and the chevron.
 *
 * Two shapes, told apart by whether `current` was passed at all. A picker that holds a selection
 * shows it; one where picking is an action rather than a state - Quick load, Apply preset - goes on
 * reading its own label, because a thing it did once is not a thing it is now.
 *
 * Everything else is passed straight through to the button, which is what lets the surface above
 * attach itself with `asChild`. */
export function PickerTrigger({
    label,
    current,
    preview,
    className,
    ...rest
}: ComponentProps<'button'> & {
    /** Names the control, and is what it reads while it holds nothing. */
    label: string;
    /** Display text of the chosen entry, null for none chosen, undefined for an action picker. */
    current?: string | null;
    /** Preview image of the chosen entry. */
    preview?: string;
}) {
    const selecting = current !== undefined;
    return (
        <button
            type="button"
            aria-label={label}
            {...rest}
            className={[
                className ?? 'w-40',
                'flex max-w-full items-center gap-1.5 rounded border border-default bg-surface-sunken py-0.5 pl-1 pr-1.5 text-left text-xs text-fg outline-none hover:border-[var(--emphasis)] focus:border-[var(--emphasis)] disabled:opacity-50'
            ].join(' ')}
        >
            {selecting && <PickerThumb preview={preview} size="xs" />}
            <span
                className={[
                    'min-w-0 flex-1 truncate',
                    current ? 'text-fg-strong' : 'text-fg-soft',
                    // The thumbnail is the left margin where there is one.
                    selecting ? '' : 'pl-0.5'
                ].join(' ')}
            >
                {selecting ? (current ?? translate('modelPicker.noneSelected')) : label}
            </span>
            <ChevronDown size={13} aria-hidden className="shrink-0 text-fg-soft" />
        </button>
    );
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
