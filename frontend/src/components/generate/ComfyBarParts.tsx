/** The pieces the workspace toolbars are built from: the editor's bar in the Comfy workspace
 *  mode, and the workflow library and preset controls in the standard one.
 */

import { useEffect, useRef, useState } from 'react';

/** A short-lived status line, the way the existing interface's `comfy_notice_slot` works. */
export interface ComfyNotice {
    message: string;
    isError: boolean;
    show: (message: string, isError?: boolean) => void;
}

export function useComfyNotice(): ComfyNotice {
    const [state, setState] = useState<{ message: string; isError: boolean } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timer.current) {
            clearTimeout(timer.current);
        }
    }, []);

    return {
        message: state?.message ?? '',
        isError: state?.isError ?? false,
        show(message: string, isError = false) {
            if (timer.current) {
                clearTimeout(timer.current);
            }
            setState({ message, isError });
            // Errors are worth reading twice; a "Saved." is not.
            timer.current = setTimeout(() => setState(null), isError ? 8000 : 2500);
        }
    };
}

/** Where a notice is read. Kept out of the controls themselves so each bar can put it at its own
 *  end, rather than having a message appear mid-row and shove the buttons along. */
export function ComfyNoticeText(props: { notice: ComfyNotice }) {
    if (!props.notice.message) {
        return null;
    }
    return (
        <p
            className="max-w-[16rem] truncate text-xs"
            style={{ color: props.notice.isError ? 'var(--backend-errored)' : 'var(--sw-fg-soft)' }}
            title={props.notice.message}
            role="status"
        >
            {props.notice.message}
        </p>
    );
}

/** Icon-only, because the toolbar shares one strip with the mode switch. The label it drops is
 *  still the button's name for a pointer and for a screen reader. */
export function IconButton(props: {
    onClick: () => void;
    disabled?: boolean;
    label: string;
    /** Shown instead of the label when there is more to say - why it is disabled, usually. */
    hint?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            aria-label={props.label}
            title={props.hint ?? props.label}
            style={props.style}
            className="flex h-6 w-6 items-center justify-center rounded border border-default text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50 disabled:hover:bg-transparent"
        >
            {props.children}
        </button>
    );
}

export const SELECT_CLASS =
    'w-28 min-w-0 rounded border border-default bg-surface-sunken px-1.5 py-0.5 text-xs text-fg outline-none focus:border-[var(--emphasis)]';
