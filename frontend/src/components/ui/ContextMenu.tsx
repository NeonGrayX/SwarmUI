import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
    type TouchEvent
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { t } from '@/i18n';

/** One row of a context menu. */
export interface MenuAction {
    label: string;
    onSelect: () => void;
    destructive?: boolean;
    /** Draws a divider above the row, separating unrelated groups of actions. */
    separated?: boolean;
}

interface MenuState {
    x: number;
    y: number;
    items: MenuAction[];
}

/** Touch handlers to spread onto the element that also carries `onContextMenu`. */
export interface LongPressHandlers {
    onTouchStart: (event: TouchEvent<HTMLElement>) => void;
    onTouchMove: (event: TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
}

export interface ContextMenuHandle {
    /** `onContextMenu` handler for one item: opens the menu at the pointer with these actions. */
    open: (event: MouseEvent, items: MenuAction[]) => void;
    /** Long-press equivalent, for touch screens. Spread onto the same element as `onContextMenu`. */
    touch: (items: MenuAction[]) => LongPressHandlers;
    /** Render once per browser, anywhere in its tree. */
    menu: ReactNode;
}

/** True while `target` sits inside an open context menu.
 *
 * A menu opened from inside another popup - a picker dropdown, say - lands in its own portal, so
 * the popup below reads clicks on it as a click outside itself and closes, taking the right-click
 * action with it. The popup checks this to leave those interactions alone. */
export function insideContextMenu(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('[data-context-menu]') !== null;
}

/** How long a finger must rest before the press counts as a menu request. */
const LONG_PRESS_MS = 500;
/** How far it may drift in that time before the gesture is a scroll instead. */
const LONG_PRESS_SLOP_PX = 10;

/** The compatibility mouse sequence a touch release replays, in order. */
const RELEASE_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'] as const;

/** Lifting the finger after a long press replays that whole sequence at the pressed point: it
 *  would activate whatever was pressed *and* read as a click outside the menu that just opened,
 *  dismissing it before it can be used. Swallow that one release in the capture phase, so it
 *  reaches neither the item nor Radix's outside-press watcher — but never swallow a press on the
 *  menu itself, which is the action the whole gesture was for. */
function swallowTapAfterLongPress(): void {
    const stop = (event: Event) => {
        if (event.target instanceof Element && event.target.closest('[data-radix-popper-content-wrapper]')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'click') {
            done();
        }
    };
    const done = () => {
        for (const type of RELEASE_EVENTS) {
            window.removeEventListener(type, stop, true);
        }
        clearTimeout(expiry);
    };
    for (const type of RELEASE_EVENTS) {
        window.addEventListener(type, stop, true);
    }
    // A release that produces no click — dragged off the item, say — never reaches `done` itself.
    const expiry = window.setTimeout(done, 700);
}

/** Up/down through the rows, which is what a menu is expected to do. Radix's popover only gives
 *  Tab, since it does not know this content is a menu. */
function moveWithArrows(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
    }
    event.preventDefault();
    const rows = [...event.currentTarget.querySelectorAll('button')];
    if (rows.length === 0) {
        return;
    }
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    // From the container itself (where Radix parks focus on open) both keys enter the list.
    const next = current === -1 ? (step === 1 ? 0 : rows.length - 1) : (current + step + rows.length) % rows.length;
    rows[next].focus();
}

/** Right-click menus for a list of items.
 *
 * One menu serves the whole list: a card hands over its own actions only when it is actually
 * right-clicked, so a thousand-image grid still renders one popover rather than a thousand.
 *
 * The keyboard menu key (and Shift+F10) also fires `contextmenu`, but with no meaningful pointer
 * position; those anchor to the item itself, which is what keeps the actions reachable without a
 * mouse now that the models browser has no visible "more actions" button. Touch gets the same
 * actions from `touch()`, on a long press. */
export function useContextMenu(): ContextMenuHandle {
    const [state, setState] = useState<MenuState | null>(null);
    /** The element focused when the menu opened, to hand focus back to on Escape. */
    const opener = useRef<HTMLElement | null>(null);
    /** Set when the menu was dismissed by clicking elsewhere, where refocusing would fight the user. */
    const dismissedOutside = useRef(false);

    const open = useCallback((event: MouseEvent, items: MenuAction[]) => {
        if (items.length === 0) {
            return;
        }
        event.preventDefault();
        // A card inside a row inside a list: only the innermost item's menu should open.
        event.stopPropagation();
        const keyboard = event.clientX === 0 && event.clientY === 0;
        const rect = event.currentTarget.getBoundingClientRect();
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dismissedOutside.current = false;
        setState({
            x: keyboard ? rect.left : event.clientX,
            y: keyboard ? rect.bottom : event.clientY,
            items
        });
    }, []);

    /** Pending long press, if a finger is currently down. */
    const press = useRef<{ timer: number; x: number; y: number } | null>(null);

    const cancelPress = useCallback(() => {
        if (press.current) {
            clearTimeout(press.current.timer);
            press.current = null;
        }
    }, []);

    // A press in flight when the browser unmounts would otherwise open a menu on nothing.
    useEffect(() => cancelPress, [cancelPress]);

    /** Touch has no right-click, and iOS Safari does not synthesise `contextmenu` from a long press
     *  the way Android Chrome does, so on a phone this is the only route to rename and delete. */
    const touch = useCallback(
        (items: MenuAction[]): LongPressHandlers => ({
            onTouchStart: event => {
                cancelPress();
                if (items.length === 0 || event.touches.length !== 1) {
                    return;
                }
                const { clientX, clientY } = event.touches[0];
                press.current = {
                    x: clientX,
                    y: clientY,
                    timer: window.setTimeout(() => {
                        press.current = null;
                        opener.current = null;
                        dismissedOutside.current = false;
                        swallowTapAfterLongPress();
                        setState({ x: clientX, y: clientY, items });
                    }, LONG_PRESS_MS)
                };
            },
            onTouchMove: event => {
                const pending = press.current;
                const point = event.touches[0];
                if (!pending || !point) {
                    return;
                }
                if (
                    Math.abs(point.clientX - pending.x) > LONG_PRESS_SLOP_PX ||
                    Math.abs(point.clientY - pending.y) > LONG_PRESS_SLOP_PX
                ) {
                    cancelPress();
                }
            },
            onTouchEnd: cancelPress,
            onTouchCancel: cancelPress
        }),
        [cancelPress]
    );

    const menu = (
        // Keying on the position is what actually moves the menu: the anchor is a zero-size element
        // parked at the pointer, and Radix measures an anchor once rather than watching it move.
        <Popover.Root
            key={state ? `${state.x}:${state.y}` : 'closed'}
            open={state !== null}
            onOpenChange={isOpen => !isOpen && setState(null)}
        >
            <Popover.Anchor
                style={{ position: 'fixed', left: state?.x ?? 0, top: state?.y ?? 0 }}
                aria-hidden
            />
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={2}
                    collisionPadding={8}
                    aria-label={t('contextMenu.label')}
                    data-context-menu=""
                    onKeyDown={moveWithArrows}
                    onPointerDownOutside={() => {
                        dismissedOutside.current = true;
                    }}
                    onCloseAutoFocus={event => {
                        event.preventDefault();
                        if (!dismissedOutside.current && opener.current?.isConnected) {
                            opener.current.focus();
                        }
                    }}
                    className="z-50 min-w-44 rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                >
                    {state?.items.map((item, index) => (
                        <div key={item.label}>
                            {item.separated && index > 0 && (
                                <div className="my-1 border-t border-subtle" role="separator" />
                            )}
                            <Popover.Close asChild>
                                <button
                                    type="button"
                                    onClick={item.onSelect}
                                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--sw-hover)]"
                                    style={{
                                        color: item.destructive ? 'var(--backend-errored)' : 'var(--text)'
                                    }}
                                >
                                    {item.label}
                                </button>
                            </Popover.Close>
                        </div>
                    ))}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );

    return { open, touch, menu };
}
