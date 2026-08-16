import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

/** Confirmation for irreversible actions.
 *
 * The legacy UI communicates danger with bold body text ("Be careful! ... There is no undo") and
 * then fires immediately on click. This puts a real decision point in front of the action. */
export function ConfirmDialog(props: {
    open: boolean;
    title: string;
    body: ReactNode;
    confirmLabel: string;
    destructive?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[min(28rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-1 text-base font-medium text-fg-strong">
                        {props.title}
                    </Dialog.Title>
                    <Dialog.Description asChild>
                        <div className="mb-4 text-sm text-fg-soft">{props.body}</div>
                    </Dialog.Description>
                    <div className="flex justify-end gap-2">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                Cancel
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            onClick={props.onConfirm}
                            className="rounded px-3 py-1.5 text-sm"
                            style={
                                props.destructive
                                    ? {
                                          background: 'var(--danger-button-background)',
                                          color: 'var(--danger-button-foreground)'
                                      }
                                    : { background: 'var(--emphasis)', color: 'var(--emphasis-text)' }
                            }
                        >
                            {props.confirmLabel}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
