import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/** A number input that keeps what is typed as a local string, so clearing the box or typing a
 *  partial value ('-', '1.') is not coerced to 0 on the way through. A parseable value is passed
 *  up as it is typed; anything else is left alone until blur, when the box snaps back to the last
 *  committed value. */
export function NumberDraftInput(
    props: {
        value: number;
        integer?: boolean;
        onCommit: (value: number) => void;
    } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>
) {
    const { value, integer, onCommit, onBlur, onFocus, ...rest } = props;
    const [draft, setDraft] = useState(String(value));
    const focused = useRef(false);

    // An outside change (reset to default, discard, reload) replaces the draft, but never while the
    // user is mid-edit in this very box.
    useEffect(() => {
        if (!focused.current) {
            setDraft(String(value));
        }
    }, [value]);

    function parse(text: string): number | null {
        if (text.trim() === '') {
            return null;
        }
        const parsed = Number(text);
        if (!Number.isFinite(parsed)) {
            return null;
        }
        return integer ? Math.trunc(parsed) : parsed;
    }

    return (
        <input
            {...rest}
            type="number"
            value={draft}
            onFocus={e => {
                focused.current = true;
                onFocus?.(e);
            }}
            onChange={e => {
                setDraft(e.target.value);
                const parsed = parse(e.target.value);
                if (parsed !== null && parsed !== value) {
                    onCommit(parsed);
                }
            }}
            onBlur={e => {
                focused.current = false;
                const parsed = parse(draft);
                setDraft(String(parsed ?? value));
                onBlur?.(e);
            }}
        />
    );
}
