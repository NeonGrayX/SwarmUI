import { useState } from 'react';
import { ChevronDown, Eye, EyeOff, Pencil, Power, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Field } from '../form/Field';
import {
    canRestart,
    isMultilineText,
    SECRET_SENTINEL,
    settingsPayload,
    STATUS_COLOR,
    type Backend,
    type BackendSettingSchema,
    type BackendType
} from '@/server/backends';

const INPUT =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)] disabled:opacity-60';

export interface BackendCardPermissions {
    edit: boolean;
    toggle: boolean;
    addRemove: boolean;
    restart: boolean;
}

/** Body for EditBackend (src/WebAPI/BackendAPI.cs:166). The index signature is only there so this
 *  can be handed straight to api.post, which takes a plain JSON object. */
export interface BackendSaveInput {
    [key: string]: unknown;
    backend_id: number;
    title: string;
    settings: Record<string, unknown>;
    new_id?: number;
}

/** One backend, with its settings panel expanding in place.
 *
 * The legacy card (src/wwwroot/js/genpage/server/backends.js:21) always renders every setting as a
 * disabled input and the ✎ button re-enables them, so a page with several backends is a wall of
 * greyed-out text boxes. Here the panel is collapsed by default: the chevron opens it read-only and
 * the ✎ opens it ready to edit, which is the same two states without the permanent noise.
 *
 * Title and ID are real labelled inputs. Legacy makes them contentEditable spans inside the card
 * heading, which is why they need a keydown handler to swallow Enter. */
export function BackendCard(props: {
    backend: Backend;
    type?: BackendType;
    perms: BackendCardPermissions;
    /** Log tracker name for this backend's process output, when it has one. */
    logName: string | null;
    saving: boolean;
    saveError: string | null;
    onSave: (input: BackendSaveInput) => void;
    onToggle: (enabled: boolean) => void;
    onRestart: () => void;
    onDelete: () => void;
}) {
    const { backend, type, perms } = props;
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    /** Values the user has actually touched. Kept separate from `baseline` so the modified dot
     *  means "you changed this", not merely "this field is being edited". */
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    /** Settings as they were when editing began. The 5s list poll must not move the ground under
     *  a half-finished edit, so the form reads from this rather than from the live query. */
    const [baseline, setBaseline] = useState<Record<string, unknown>>({});
    const [title, setTitle] = useState(backend.title);
    const [idText, setIdText] = useState(String(backend.id));
    const [revealed, setRevealed] = useState<Record<string, boolean>>({});

    const schema = type?.settings ?? [];

    function startEdit() {
        setBaseline({ ...backend.settings });
        setDraft({});
        setTitle(backend.title);
        setIdText(String(backend.id));
        setEditing(true);
        setOpen(true);
    }

    function cancelEdit() {
        setEditing(false);
        setDraft({});
        setRevealed({});
    }

    function save() {
        const parsedId = parseInt(idText, 10);
        const input: BackendSaveInput = {
            backend_id: backend.id,
            title: title.trim() || (type?.name ?? backend.type),
            settings: settingsPayload(schema, baseline, draft)
        };
        if (Number.isFinite(parsedId) && parsedId !== backend.id && parsedId >= 0) {
            input.new_id = parsedId;
        }
        props.onSave(input);
        setEditing(false);
        // Drop the draft too, or the modified dots would linger over the now-saved values.
        setDraft({});
        setRevealed({});
    }

    const source = editing ? baseline : backend.settings;
    const valueOf = (field: BackendSettingSchema) =>
        field.name in draft ? draft[field.name] : source[field.name];
    const isDirty = (field: BackendSettingSchema) =>
        field.name in draft && String(draft[field.name]) !== String(baseline[field.name]);
    const set = (name: string, value: unknown) => setDraft(d => ({ ...d, [name]: value }));

    return (
        <li className="overflow-hidden rounded-lg border border-default bg-surface">
            <div className="flex items-start gap-2 p-3">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    aria-label={open ? 'Hide settings' : 'Show settings'}
                    className="mt-0.5 shrink-0 rounded p-1 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                >
                    <ChevronDown
                        size={14}
                        aria-hidden
                        className={`transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                </button>
                <span
                    title={backend.status}
                    className="mt-2 size-2.5 shrink-0 rounded-full"
                    style={{ background: STATUS_COLOR[backend.status] ?? 'var(--gray)' }}
                />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg-strong">
                        {backend.title || type?.name || backend.type}{' '}
                        <span className="text-xs text-fg-soft">#{backend.id}</span>
                    </p>
                    <p className="text-xs text-fg-soft">
                        {type?.name ?? backend.type} · {backend.status}
                        {backend.current_model && ` · ${backend.current_model}`}
                        {` · last used ${backend.time_since_used}`}
                    </p>
                </div>

                {perms.restart && (
                    <IconButton
                        label="Restart backend"
                        onClick={props.onRestart}
                        disabled={!canRestart(backend.status)}
                        hint={
                            canRestart(backend.status)
                                ? 'Restart'
                                : `Cannot restart while ${backend.status}`
                        }
                    >
                        <RefreshCw size={14} aria-hidden />
                    </IconButton>
                )}
                {props.logName ? (
                    <Link
                        to="/server/logs"
                        search={{ types: props.logName }}
                        title="View this backend's logs"
                        aria-label="View backend logs"
                        className="shrink-0 rounded border border-default p-1.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        <ScrollText size={14} aria-hidden />
                    </Link>
                ) : (
                    <IconButton label="View backend logs" disabled hint="No process logs for this backend">
                        <ScrollText size={14} aria-hidden />
                    </IconButton>
                )}
                {perms.edit && (
                    <IconButton
                        label={editing ? 'Editing settings' : 'Edit settings'}
                        hint={editing ? 'Editing' : 'Edit settings'}
                        onClick={startEdit}
                        disabled={editing}
                        active={editing}
                    >
                        <Pencil size={14} aria-hidden />
                    </IconButton>
                )}
                {perms.toggle && (
                    <IconButton
                        label={backend.enabled ? 'Disable backend' : 'Enable backend'}
                        hint={backend.enabled ? 'Disable' : 'Enable'}
                        onClick={() => props.onToggle(!backend.enabled)}
                        color={backend.enabled ? 'var(--backend-running)' : undefined}
                    >
                        <Power size={14} aria-hidden />
                    </IconButton>
                )}
                {perms.addRemove && (
                    <IconButton
                        label="Delete backend"
                        hint="Delete"
                        onClick={props.onDelete}
                        color="var(--backend-errored)"
                    >
                        <Trash2 size={14} aria-hidden />
                    </IconButton>
                )}
            </div>

            {open && (
                <div
                    className="border-t border-subtle px-3 py-3"
                    // Wider than the app default: backend setting names are raw C# field names
                    // like ConnectionAttemptTimeoutSeconds, which truncate at 11rem.
                    style={{ ['--sw-field-label-width' as string]: '17rem' }}
                >
                    {!type && (
                        <p className="mb-2 text-xs" style={{ color: 'var(--backend-disabled)' }}>
                            Backend type "{backend.type}" is not registered on this server, so its settings
                            cannot be described. The stored values are left untouched.
                        </p>
                    )}

                    <Field id={`backend-${backend.id}-title`} label="Title" density="compact" description="Display name for this backend.">
                        <input
                            id={`backend-${backend.id}-title`}
                            type="text"
                            value={editing ? title : backend.title}
                            disabled={!editing}
                            onChange={e => setTitle(e.target.value)}
                            className={`${INPUT} w-full`}
                        />
                    </Field>
                    <Field
                        id={`backend-${backend.id}-id`}
                        label="Backend ID"
                        density="compact"
                        description="Numeric identifier. Changing it reassigns the backend and restarts it."
                    >
                        <input
                            id={`backend-${backend.id}-id`}
                            type="number"
                            min={0}
                            step={1}
                            value={editing ? idText : String(backend.id)}
                            disabled={!editing}
                            onChange={e => setIdText(e.target.value)}
                            className={`${INPUT} w-24`}
                        />
                    </Field>

                    {schema.map(field => (
                        <SettingField
                            key={field.name}
                            backendId={backend.id}
                            field={field}
                            value={valueOf(field)}
                            editing={editing}
                            edited={isDirty(field)}
                            revealed={Boolean(revealed[field.name])}
                            onReveal={() => setRevealed(r => ({ ...r, [field.name]: !r[field.name] }))}
                            onChange={v => set(field.name, v)}
                        />
                    ))}

                    {backend.features.length > 0 && (
                        <div className="mt-3 border-t border-subtle pt-2">
                            <p className="mb-1 text-[10px] uppercase tracking-wide text-fg-soft">
                                Supported features ({backend.features.length})
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {backend.features.map(feature => (
                                    <span
                                        key={feature}
                                        className="rounded-full border border-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-soft"
                                    >
                                        {feature}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {editing && (
                        <div className="mt-3 flex items-center gap-2 border-t border-subtle pt-2">
                            <p className="min-w-0 flex-1 text-xs" style={{ color: 'var(--backend-disabled)' }}>
                                Saving restarts this backend. Any generation running on it will be interrupted.
                            </p>
                            <button
                                type="button"
                                onClick={cancelEdit}
                                className="rounded border border-default px-3 py-1 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={save}
                                disabled={props.saving}
                                className="rounded px-3 py-1 text-sm disabled:opacity-50"
                                style={{ background: 'var(--emphasis)', color: 'var(--emphasis-text)' }}
                            >
                                {props.saving ? 'Saving…' : 'Save changes'}
                            </button>
                        </div>
                    )}

                    {props.saveError && (
                        <p className="mt-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {props.saveError}
                        </p>
                    )}
                </div>
            )}
        </li>
    );
}

function SettingField(props: {
    backendId: number;
    field: BackendSettingSchema;
    value: unknown;
    editing: boolean;
    edited: boolean;
    revealed: boolean;
    onReveal: () => void;
    onChange: (value: unknown) => void;
}) {
    const { field } = props;
    const id = `backend-${props.backendId}-${field.name}`;

    return (
        <Field
            id={id}
            label={field.name}
            description={field.description || undefined}
            density="compact"
            modified={props.edited}
        >
            <SettingControl {...props} id={id} />
        </Field>
    );
}

function SettingControl(props: {
    id: string;
    field: BackendSettingSchema;
    value: unknown;
    editing: boolean;
    revealed: boolean;
    onReveal: () => void;
    onChange: (value: unknown) => void;
}) {
    const { field, value, editing, id } = props;
    const disabled = !editing;

    if (field.type === 'group') {
        // ListBackendTypes emits sections as a bare 'group' with no child schema, so there is
        // nothing to render. Legacy hits the same wall and logs to console instead of saying so.
        return (
            <p className="py-1 text-xs text-fg-soft">
                Grouped settings aren't editable here — edit this backend in the server config file.
            </p>
        );
    }

    if (field.is_secret) {
        const isSet = value === SECRET_SENTINEL || (value !== '' && value != null);
        const typed = editing && value !== SECRET_SENTINEL;
        return (
            <div className="flex items-center gap-1">
                <input
                    id={id}
                    type={props.revealed ? 'text' : 'password'}
                    value={typed ? String(value ?? '') : ''}
                    placeholder={isSet ? '(set — type to replace)' : '(not set)'}
                    disabled={disabled}
                    onChange={e => props.onChange(e.target.value)}
                    className={`${INPUT} min-w-0 flex-1`}
                />
                <button
                    type="button"
                    onClick={props.onReveal}
                    disabled={disabled}
                    aria-label={props.revealed ? 'Hide value' : 'Show value'}
                    className="shrink-0 rounded border border-default p-1.5 text-fg-soft hover:text-fg disabled:opacity-50"
                >
                    {props.revealed ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                </button>
            </div>
        );
    }

    if (field.values && field.values.length > 0) {
        return (
            <select
                id={id}
                value={String(value ?? '')}
                disabled={disabled}
                onChange={e => props.onChange(e.target.value)}
                className={`${INPUT} w-full`}
            >
                {field.values.map((option, i) => (
                    <option key={option} value={option}>
                        {field.value_names?.[i] || option}
                    </option>
                ))}
            </select>
        );
    }

    switch (field.type) {
        case 'boolean':
            return (
                <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                        id={id}
                        type="checkbox"
                        checked={value === true || value === 'true'}
                        disabled={disabled}
                        onChange={e => props.onChange(e.target.checked)}
                        className="accent-[var(--emphasis)]"
                    />
                    <span className="text-sm text-fg-soft">
                        {value === true || value === 'true' ? 'On' : 'Off'}
                    </span>
                </label>
            );
        case 'integer':
        case 'decimal':
            return (
                <input
                    id={id}
                    type="number"
                    step={field.type === 'integer' ? 1 : 'any'}
                    value={String(value ?? 0)}
                    disabled={disabled}
                    placeholder={field.placeholder || undefined}
                    onChange={e => props.onChange(e.target.value)}
                    className={`${INPUT} w-32`}
                />
            );
        case 'list':
            return (
                <textarea
                    id={id}
                    rows={2}
                    value={String(value ?? '')}
                    disabled={disabled}
                    placeholder={field.placeholder || 'Separate entries with ||'}
                    onChange={e => props.onChange(e.target.value)}
                    className={`${INPUT} w-full resize-y font-mono text-xs`}
                />
            );
        default:
            if (isMultilineText(field, value)) {
                return (
                    <textarea
                        id={id}
                        rows={3}
                        value={String(value ?? '')}
                        disabled={disabled}
                        placeholder={field.placeholder || 'One per line, eg  MyHeader: MyVal'}
                        onChange={e => props.onChange(e.target.value)}
                        className={`${INPUT} w-full resize-y font-mono text-xs`}
                        spellCheck={false}
                    />
                );
            }
            return (
                <input
                    id={id}
                    type="text"
                    value={String(value ?? '')}
                    disabled={disabled}
                    placeholder={field.placeholder || undefined}
                    onChange={e => props.onChange(e.target.value)}
                    className={`${INPUT} w-full`}
                />
            );
    }
}

function IconButton(props: {
    label: string;
    hint?: string;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    color?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            aria-label={props.label}
            title={props.hint ?? props.label}
            className="shrink-0 rounded border border-default p-1.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            style={{
                color: props.color,
                ...(props.active ? { background: 'var(--sw-active)' } : {})
            }}
        >
            {props.children}
        </button>
    );
}
