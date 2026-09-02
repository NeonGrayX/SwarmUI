import type { SavedWorkflow } from '@/comfy/actions';

/** One saved workflow, as a picture with its name under it.
 *
 * Workflow names carry their folder as a path prefix ('Examples/Basic'), which is shown as a
 * subtitle rather than as a folder tree - the lists these appear in are short enough that search
 * beats navigation.
 */
export function WorkflowCard(props: {
    workflow: SavedWorkflow;
    onOpen: () => void;
    /** Buttons overlaid on the thumbnail. Kept out of the way until the card is reached for:
     *  opening is the common action, and a delete button under the pointer is a bad default. */
    actions?: React.ReactNode;
}) {
    const { name, description, image } = props.workflow;
    const slash = name.lastIndexOf('/');
    const folder = slash > 0 ? name.substring(0, slash) : null;
    const label = slash > 0 ? name.substring(slash + 1) : name;

    return (
        <li className="group relative overflow-hidden rounded-lg border border-subtle bg-surface">
            <button type="button" onClick={props.onOpen} className="block w-full text-left" title={description || name}>
                <img
                    src={image}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full bg-surface-sunken object-cover"
                />
                <span className="block px-2 py-1.5">
                    <span className="block truncate text-sm text-fg-strong">{label}</span>
                    {folder && <span className="block truncate text-[11px] text-fg-soft">{folder}</span>}
                    {description && <span className="mt-0.5 block line-clamp-2 text-xs text-fg-soft">{description}</span>}
                </span>
            </button>
            {props.actions && (
                <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {props.actions}
                </div>
            )}
        </li>
    );
}

/** An action on a card, sitting over its thumbnail. */
export function WorkflowCardButton(props: {
    label: string;
    destructive?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            title={props.label}
            className="rounded p-1.5 backdrop-blur"
            style={{
                background: props.destructive ? 'var(--sw-danger-surface)' : 'var(--sw-surface-raised)',
                color: props.destructive ? 'var(--backend-errored)' : 'var(--text)'
            }}
        >
            {props.children}
        </button>
    );
}
