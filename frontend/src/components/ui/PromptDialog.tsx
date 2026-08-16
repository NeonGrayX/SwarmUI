import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

/** Single-text-input dialog, used for rename-style actions.
 *  Replaces the browser `prompt()` calls the legacy UI uses for renames. */
export function PromptDialog(props: {
    open: boolean;
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    hint?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(props.initialValue);

    useEffect(() => {
        if (props.open) {
            setValue(props.initialValue);
        }
    }, [props.open, props.initialValue]);

    const unchanged = value.trim() === props.initialValue.trim();

    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[min(32rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-3 text-base font-medium text-fg-strong">
                        {props.title}
                    </Dialog.Title>
                    <label className="mb-1 block text-xs text-fg-soft" htmlFor="prompt-dialog-input">
                        {props.label}
                    </label>
                    <input
                        id="prompt-dialog-input"
                        type="text"
                        value={value}
                        autoFocus
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && value.trim() && !unchanged) {
                                props.onConfirm(value.trim());
                            }
                        }}
                        className="w-full rounded border border-default bg-surface-sunken px-2 py-1.5 font-mono text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                    {props.hint && <p className="mt-1.5 text-xs text-fg-soft">{props.hint}</p>}
                    <div className="mt-4 flex justify-end gap-2">
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
                            disabled={!value.trim() || unchanged}
                            onClick={() => props.onConfirm(value.trim())}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                            style={{ background: 'var(--emphasis)', color: 'var(--emphasis-text)' }}
                        >
                            {props.confirmLabel}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
