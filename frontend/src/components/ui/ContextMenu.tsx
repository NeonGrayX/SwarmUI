import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
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

export interface ContextMenuHandle {
    /** `onContextMenu` handler for one item: opens the menu at the pointer with these actions. */
    open: (event: MouseEvent, items: MenuAction[]) => void;
    /** Render once per browser, anywhere in its tree. */
    menu: ReactNode;
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
 * mouse now that the models browser has no visible "more actions" button. */
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

    return { open, menu };
}
