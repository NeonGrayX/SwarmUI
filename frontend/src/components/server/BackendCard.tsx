import { useState } from 'react';
import { ChevronDown, Eye, EyeOff, Pencil, Power, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Field } from '../form/Field';
import {
    canRestart,
    isLive,
    isMultilineText,
    SECRET_SENTINEL,
    settingsPayload,
    statusLabel,
    STATUS_COLOR,
    type Backend,
    type BackendSettingSchema,
    type BackendType
} from '@/server/backends';
import { useTranslation } from '@/i18n';

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

/** One backend, with its settings panel expanding in place. The panel is collapsed by default:
 *  the chevron opens it read-only, the ✎ opens it ready to edit. */
export function BackendCard(props: {
    backend: Backend;
    type?: BackendType;
    perms: BackendCardPermissions;
    /** Log tracker name for this backend's process output, when it has one. */
    logName: string | null;
    saving: boolean;
    saveError: string | null;
    onSave: (input: BackendSaveInput) => void;
    /** Flips the backend between live and off; the page works out which way from the backend. */
    onToggle: () => void;
    onRestart: () => void;
    onDelete: () => void;
}) {
    const { t, tDynamic } = useTranslation();
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
    const [featuresOpen, setFeaturesOpen] = useState(false);

    const schema = type?.settings ?? [];
    const live = isLive(backend);

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
                    aria-label={open ? t('backendCard.hideSettings') : t('backendCard.showSettings')}
                    className="mt-0.5 shrink-0 rounded p-1 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                >
                    <ChevronDown
                        size={14}
                        aria-hidden
                        className={`transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                </button>
                <span
                    title={statusLabel(backend.status)}
                    className="mt-2 size-2.5 shrink-0 rounded-full"
                    style={{ background: STATUS_COLOR[backend.status] ?? 'var(--gray)' }}
                />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg-strong">
                        {backend.title || tDynamic(type?.name) || backend.type}{' '}
                        <span className="text-xs text-fg-soft">#{backend.id}</span>
                    </p>
                    <p className="text-xs text-fg-soft">
                        {type ? tDynamic(type.name) : backend.type} · {statusLabel(backend.status)}
                        {backend.current_model && ` · ${backend.current_model}`}
                        {` · ${t('backendCard.lastUsed', { when: backend.time_since_used })}`}
                    </p>
                </div>

                {perms.restart && (
                    <IconButton
                        label={t('backendCard.restartBackend')}
                        onClick={props.onRestart}
                        disabled={!canRestart(backend.status)}
                        hint={
                            canRestart(backend.status)
                                ? t('backends.restart')
                                : t('backendCard.cannotRestart', { status: statusLabel(backend.status) })
                        }
                    >
                        <RefreshCw size={14} aria-hidden />
                    </IconButton>
                )}
                {props.logName ? (
                    <Link
                        to="/server/logs"
                        search={{ types: props.logName }}
                        title={t('backendCard.viewLogsHint')}
                        aria-label={t('backendCard.viewLogs')}
                        className="shrink-0 rounded border border-default p-1.5 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        <ScrollText size={14} aria-hidden />
                    </Link>
                ) : (
                    <IconButton
                        label={t('backendCard.viewLogs')}
                        disabled
                        hint={t('backendCard.noProcessLogs')}
                    >
                        <ScrollText size={14} aria-hidden />
                    </IconButton>
                )}
                {perms.edit && (
                    <IconButton
                        label={editing ? t('backendCard.editingSettings') : t('backendCard.editSettings')}
                        hint={editing ? t('backendCard.editing') : t('backendCard.editSettings')}
                        onClick={startEdit}
                        disabled={editing}
                        active={editing}
                    >
                        <Pencil size={14} aria-hidden />
                    </IconButton>
                )}
                {perms.toggle && (
                    <IconButton
                        label={live ? t('backendCard.disableBackend') : t('backendCard.enableBackend')}
                        hint={live ? t('common.disable') : t('common.enable')}
                        onClick={props.onToggle}
                        color={live ? 'var(--backend-running)' : undefined}
                    >
                        <Power size={14} aria-hidden />
                    </IconButton>
                )}
                {perms.addRemove && (
                    <IconButton
                        label={t('backendCard.deleteBackend')}
                        hint={t('common.delete')}
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
                            {t('backendCard.unknownType', { type: backend.type })}
                        </p>
                    )}

                    <Field
                        id={`backend-${backend.id}-title`}
                        label={t('backendCard.field.title')}
                        density="compact"
                        description={t('backendCard.field.titleHelp')}
                    >
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
                        label={t('backendCard.field.id')}
                        density="compact"
                        description={t('backendCard.field.idHelp')}
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

                    {/* Collapsed by default: these are the feature-IDs T2IEngine matches a request's
                      * RequiredFlags against (src/Text2Image/T2IEngine.cs:103), so they explain a
                      * refusal, but ComfyUI backends all read from one static set
                      * (src/BuiltinExtensions/ComfyUIBackend/ComfyUIBackendExtension.cs:38) and so
                      * print the same dozen-plus chips on every card. Only a remote Swarm or an LLM
                      * backend reports anything of its own. */}
                    {backend.features.length > 0 && (
                        <div className="mt-3 border-t border-subtle pt-2">
                            <button
                                type="button"
                                onClick={() => setFeaturesOpen(o => !o)}
                                aria-expanded={featuresOpen}
                                className="flex items-center gap-1 rounded text-[10px] uppercase tracking-wide text-fg-soft hover:text-fg"
                            >
                                <ChevronDown
                                    size={12}
                                    aria-hidden
                                    className={`transition-transform ${featuresOpen ? '' : '-rotate-90'}`}
                                />
                                {t('backendCard.supportedFeatures', { count: backend.features.length })}
                            </button>
                            {featuresOpen && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {backend.features.map(feature => (
                                        <span
                                            key={feature}
                                            className="rounded-full border border-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-soft"
                                        >
                                            {feature}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {editing && (
                        <div className="mt-3 flex items-center gap-2 border-t border-subtle pt-2">
                            <p className="min-w-0 flex-1 text-xs" style={{ color: 'var(--backend-disabled)' }}>
                                {t('backendCard.saveWarning')}
                            </p>
                            <button
                                type="button"
                                onClick={cancelEdit}
                                className="rounded border border-default px-3 py-1 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={save}
                                disabled={props.saving}
                                className="rounded px-3 py-1 text-sm disabled:opacity-50"
                                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                            >
                                {props.saving ? t('common.saving') : t('settings.saveChanges')}
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
    const { tDynamic } = useTranslation();
    const { field } = props;
    const id = `backend-${props.backendId}-${field.name}`;

    return (
        <Field
            id={id}
            label={field.name}
            description={field.description ? tDynamic(field.description) : undefined}
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
    const { t, tDynamic } = useTranslation();
    const { field, value, editing, id } = props;
    const disabled = !editing;

    if (field.type === 'group') {
        // ListBackendTypes emits sections as a bare 'group' with no child schema, so there is
        // nothing to render; say so rather than dropping the row silently.
        return (
            <p className="py-1 text-xs text-fg-soft">{t('backendCard.groupedSettings')}</p>
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
                    placeholder={isSet ? t('settings.secretSet') : t('settings.secretUnset')}
                    disabled={disabled}
                    onChange={e => props.onChange(e.target.value)}
                    className={`${INPUT} min-w-0 flex-1`}
                />
                <button
                    type="button"
                    onClick={props.onReveal}
                    disabled={disabled}
                    aria-label={props.revealed ? t('settings.hideValue') : t('settings.showValue')}
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
                        {field.value_names?.[i] ? tDynamic(field.value_names[i]) : option}
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
                        {value === true || value === 'true' ? t('common.on') : t('common.off')}
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
                    placeholder={field.placeholder || t('settings.listPlaceholder')}
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
                        placeholder={field.placeholder || t('backendCard.headersPlaceholder')}
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
