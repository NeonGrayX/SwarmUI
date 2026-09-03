/** The model downloader's form, split out from its tool page so the Library can raise the same
 *  thing in a popup.
 *
 * The page and the popup are two frames around one form: the fields, the link resolution and the
 * job they start are all here, and each caller only decides where the fields and the start button
 * sit. Because the job goes into the shared job store (src/tools/jobs.ts), a download started in
 * either place reports progress in both.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { queryKeys } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { Field } from '@/components/form/Field';
import { subtypeNoun } from '@/library/catalog';
import { useParamSchema } from '@/params/schema';
import {
    folderOptions,
    LIBRARY_SUBTYPES,
    previewToThumbnail,
    resolveModelSource,
    type CivitaiChoice,
    type CivitaiInfo,
    type ModelSource,
    type Preview
} from '@/tools/modelSource';
import { backendLabel, canReceiveDownloads, usesLocalModelFolders, type Backend } from '@/server/backends';
import { useJobStore } from '@/tools/jobs';
import { hasTranslation, useTranslation, type Translator } from '@/i18n';

const INPUT_CLASS =
    'w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

/** How long to sit on a keystroke before asking Civitai about the link. */
const LOOKUP_DEBOUNCE_MS = 400;

/** Display name of a subtype. The five Library categories get their own singular labels, since
 *  'Base Model' reads better in a picker than the internal id 'Stable-Diffusion'; anything else
 *  falls back to the same noun the Library and the model pickers use. */
export function subtypeLabel(subtype: string, t: Translator['t']): string {
    const key = `downloader.type.${subtype}`;
    return hasTranslation(key) ? t(key) : subtypeNoun(subtype);
}

export interface DownloaderFormOptions {
    /** Model type the form opens on, for a downloader opened from one Library category. A link
     *  that names its own type still overrides it — the source knows better than the caller. */
    initialType?: string;
    /** Folder to preselect, applied only once it turns out to be one this type actually has. */
    initialFolder?: string;
}

export interface DownloaderForm {
    /** Every input of the form, for whichever frame is drawing it. */
    fields: ReactNode;
    /** Whether the link resolved to something downloadable under a usable name. */
    canRun: boolean;
    start: () => void;
}

/** The downloader form as state plus a block of fields, in the same shape as `useContextMenu`:
 *  the caller renders `fields` where it wants them and wires `start` to its own button, which on
 *  the tool page sits outside the panel the fields are in. */
export function useDownloaderForm(options: DownloaderFormOptions = {}): DownloaderForm {
    const { initialType, initialFolder } = options;
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const schema = useParamSchema();
    // The Civitai lookup runs through ForwardMetadataRequest, which is gated on this permission.
    const canLookup = usePermission('edit_model_metadata');
    const run = useJobStore(s => s.run);
    // The check is a courtesy, not a gate: without the permission there is no backend list to read,
    // and the form falls back to downloading here with no target picker and no reach warning.
    const canSeeBackends = usePermission('view_backends_list');
    // Same key and payload as ComfyWorkflow's query, so this shares that cache rather than adding
    // a request of its own.
    const backends = useQuery({
        queryKey: ['backends'],
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', {}),
        enabled: canSeeBackends,
        refetchInterval: 10_000
    });
    const live = useMemo(
        () => Object.values(backends.data ?? {}).filter(b => b.status === 'running' || b.status === 'idle'),
        [backends.data]
    );
    /** Backends the download can be handed to instead of running here. */
    const targets = useMemo(() => live.filter(canReceiveDownloads), [live]);

    const [url, setUrl] = useState('');
    /** Backend id to download onto, or '' for this server. */
    const [target, setTarget] = useState('');
    const [type, setType] = useState(initialType ?? 'Stable-Diffusion');
    const [folder, setFolder] = useState('');
    const [name, setName] = useState('');
    // Suggestions stop filling a field once the user has taken it over, and start again when the
    // URL changes to point at a different model.
    const [nameEdited, setNameEdited] = useState(false);
    const [typeEdited, setTypeEdited] = useState(false);
    const [folderEdited, setFolderEdited] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    // Which version and file of a Civitai model to take, once the user has said. Cleared whenever
    // the URL changes, since a different link is a different model to choose within.
    const [choice, setChoice] = useState<CivitaiChoice>({});

    const trimmedUrl = url.trim();
    const [lookupUrl, setLookupUrl] = useState('');
    useEffect(() => {
        // Debounced, or a Civitai link would cost one API round trip per character typed.
        const timer = setTimeout(() => setLookupUrl(trimmedUrl), LOOKUP_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [trimmedUrl]);

    const lookup = useQuery({
        queryKey: ['model-source', lookupUrl, canLookup, choice.versionId, choice.fileId],
        queryFn: () => resolveModelSource(lookupUrl, canLookup, choice),
        enabled: lookupUrl.length > 0,
        staleTime: 5 * 60 * 1000,
        retry: false,
        // Switching version or file re-resolves the same link, so the card it fills stays put
        // instead of collapsing and reappearing under the cursor. A different link is a different
        // model, and showing the old one against it would be a lie, so that case still blanks.
        placeholderData: (previous, previousQuery) =>
            previousQuery?.queryKey[1] === lookupUrl ? previous : undefined
    });
    // While the URL is being edited the previous answer describes a URL that is no longer typed in.
    const source = lookupUrl.length > 0 && lookupUrl === trimmedUrl ? (lookup.data ?? null) : null;
    const resolving = trimmedUrl.length > 0 && (lookupUrl !== trimmedUrl || lookup.isFetching);

    const previews = source?.civitai?.previews ?? [];
    const preview: Preview | null = previews[previewIndex] ?? null;

    useEffect(() => {
        setPreviewIndex(0);
    }, [source]);

    useEffect(() => {
        if (source?.suggestedName && !nameEdited) {
            setName(source.suggestedName);
        }
    }, [source, nameEdited]);

    useEffect(() => {
        if (source?.subtype && !typeEdited) {
            setType(source.subtype);
        }
    }, [source, typeEdited]);

    useEffect(() => {
        setThumbnail(null);
        if (!preview) {
            return;
        }
        let live = true;
        previewToThumbnail(preview).then(data => {
            if (live) {
                setThumbnail(data);
            }
        });
        return () => {
            live = false;
        };
    }, [preview]);

    const folders = useMemo(() => folderOptions(schema?.models[type] ?? []), [schema, type]);
    useEffect(() => {
        // A folder that exists for LoRAs need not exist for VAEs.
        if (folder && !folders.includes(folder)) {
            setFolder('');
        }
        // The browsed folder is only offered once the folder list has loaded and turns out to hold
        // it — an empty folder, or one belonging to a different type, is not a place this can save.
        else if (!folder && !folderEdited && initialFolder && folders.includes(initialFolder)) {
            setFolder(initialFolder);
        }
    }, [folders, folder, folderEdited, initialFolder]);

    const targetBackend = targets.find(b => String(b.id) === target) ?? null;
    useEffect(() => {
        // A backend that went down or was deleted mid-form is no longer somewhere this can send a
        // download, so the target falls back to this server rather than failing on start.
        if (target && !targets.some(b => String(b.id) === target)) {
            setTarget('');
        }
    }, [targets, target]);

    const extraTypes = useMemo(
        () => Object.keys(schema?.models ?? {}).filter(key => !LIBRARY_SUBTYPES.includes(key)).sort(),
        [schema]
    );

    const cleanName = name.trim().replace(/\s+/g, '_');
    const fullName = folder ? `${folder}/${cleanName}` : cleanName;
    // Matches the server's own choice of extension (ModelsAPI.cs:597).
    const extension = source?.downloadUrl.endsWith('.gguf') ? 'gguf' : 'safetensors';
    const canRun = Boolean(source?.ok) && cleanName.length > 0;

    function start() {
        if (!source) {
            return;
        }
        const metadata = source.metadata
            ? JSON.stringify(thumbnail ? { ...source.metadata, 'modelspec.thumbnail': thumbnail } : source.metadata, null, 2)
            : undefined;
        run({
            title: targetBackend
                ? t('downloader.jobTitleRemote', {
                      type: subtypeLabel(type, t),
                      name: fullName,
                      backend: backendLabel(targetBackend)
                  })
                : t('downloader.jobTitle', { type: subtypeLabel(type, t), name: fullName }),
            route: 'DoModelDownloadWS',
            // Omitted rather than sent empty for the local case, so the request is byte-identical
            // to what it was before targets existed.
            payload: { url: source.downloadUrl, type, name: fullName, metadata, backendId: target || undefined },
            onDone: () => {
                // The model exists now; the Library and every model picker are a refresh behind.
                queryClient.invalidateQueries({ queryKey: ['models'] });
                queryClient.invalidateQueries({ queryKey: queryKeys.t2iParams });
            }
        });
    }

    const fields = (
        <>
            <Field
                id="dl-url"
                label={t('downloader.url')}
                description={t('downloader.urlHelp')}
                density="compact"
            >
                <input
                    id="dl-url"
                    type="url"
                    value={url}
                    onChange={e => {
                        setUrl(e.target.value);
                        setNameEdited(false);
                        setTypeEdited(false);
                        setChoice({});
                    }}
                    placeholder="https://…"
                    className={INPUT_CLASS}
                />
            </Field>

            <SourcePanel source={source} resolving={resolving} />

            {source?.civitai && (
                <CivitaiCard
                    info={source.civitai}
                    preview={preview}
                    index={previewIndex}
                    onStep={delta =>
                        setPreviewIndex(current => (current + delta + previews.length) % previews.length)
                    }
                    // Neither pick clears the 'user edited this' flags: a name or type typed in by
                    // hand survives switching version, exactly as it survives everything else the
                    // lookup suggests. Fields still untouched follow the new pick on their own.
                    onPickVersion={versionId => {
                        // A file id belongs to one version, so picking a version starts over from
                        // that version's own default file.
                        setChoice({ versionId });
                    }}
                    onPickFile={fileId =>
                        setChoice(current => ({
                            versionId: current.versionId ?? source.civitai?.versionId,
                            fileId
                        }))
                    }
                />
            )}

            {targets.length > 0 && (
                <Field
                    id="dl-target"
                    label={t('downloader.target')}
                    description={t('downloader.targetHelp')}
                    density="compact"
                >
                    <select
                        id="dl-target"
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        className={INPUT_CLASS}
                    >
                        <option value="">{t('downloader.targetLocal')}</option>
                        {targets.map(backend => (
                            <option key={backend.id} value={String(backend.id)}>
                                {backendLabel(backend)}
                            </option>
                        ))}
                    </select>
                </Field>
            )}

            <Field
                id="dl-type"
                label={t('downloader.modelType')}
                description={t('downloader.modelTypeHelp')}
                density="compact"
            >
                <select
                    id="dl-type"
                    value={type}
                    onChange={e => {
                        setType(e.target.value);
                        setTypeEdited(true);
                    }}
                    className={INPUT_CLASS}
                >
                    {LIBRARY_SUBTYPES.map(option => (
                        <option key={option} value={option}>
                            {subtypeLabel(option, t)}
                        </option>
                    ))}
                    {extraTypes.length > 0 && (
                        <optgroup label={t('downloader.otherTypes')}>
                            {extraTypes.map(option => (
                                <option key={option} value={option}>
                                    {subtypeLabel(option, t)}
                                </option>
                            ))}
                        </optgroup>
                    )}
                </select>
            </Field>

            <Field
                id="dl-folder"
                label={t('downloader.folder')}
                description={t('downloader.folderHelp')}
                density="compact"
            >
                <select
                    id="dl-folder"
                    value={folder}
                    onChange={e => {
                        setFolder(e.target.value);
                        setFolderEdited(true);
                    }}
                    className={INPUT_CLASS}
                >
                    <option value="">{t('downloader.folderRoot')}</option>
                    {folders.map(option => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            </Field>

            <Field
                id="dl-name"
                label={t('common.saveAs')}
                description={t('downloader.saveAsHelp')}
                density="compact"
            >
                <input
                    id="dl-name"
                    type="text"
                    value={name}
                    onChange={e => {
                        setName(e.target.value);
                        setNameEdited(true);
                    }}
                    placeholder={t('downloader.namePlaceholder')}
                    className={`${INPUT_CLASS} font-mono`}
                />
            </Field>

            {cleanName.length > 0 && (
                <p className="pt-1 text-xs text-fg-soft">
                    {targetBackend
                        ? t('downloader.savesToRemote', {
                              type: subtypeLabel(type, t),
                              path: `${fullName}.${extension}`,
                              backend: backendLabel(targetBackend)
                          })
                        : t('downloader.savesTo', {
                              type: subtypeLabel(type, t),
                              path: `${fullName}.${extension}`
                          })}
                </p>
            )}

            {/* A download aimed at a backend lands on that backend's own disk, so the question of
                what can reach this server's folders does not arise. */}
            {canSeeBackends && backends.data && !targetBackend && <ReachNotice live={live} />}
        </>
    );

    return { fields, canRun, start };
}

/** The one thing about downloading models that is worth interrupting for, wherever the form is
 *  drawn. */
export function DownloaderWarning() {
    const { t } = useTranslation();
    return (
        <>
            {t('downloader.warningBefore')} <code className="font-mono">.ckpt</code>{' '}
            {t('downloader.warningAfter')}
        </>
    );
}

/** Whether anything running could actually load what a download aimed at *this server* leaves
 *  behind.
 *
 * The server downloads to its own model folders, so on a setup whose backends all live on other
 * machines the file lands somewhere nothing will ever read it. That is a bad thing to discover
 * several gigabytes in, so it is said up front — as a warning only, since the download itself is
 * still legitimate (a backend may be started later, or the folder may be a network share this
 * cannot see from here).
 *
 * Remote Swarm backends can be downloaded to directly, so where one is running the warning points
 * at the target picker rather than just stating the problem. */
function ReachNotice(props: { live: Backend[] }) {
    const { t } = useTranslation();
    const { live } = props;
    if (live.some(usesLocalModelFolders)) {
        return null;
    }
    const message = live.some(canReceiveDownloads)
        ? t('downloader.pickBackend')
        : live.length > 0
          ? t('downloader.noLocalBackend')
          : t('downloader.noBackends');
    return (
        <p
            className="flex items-start gap-1.5 pt-2 text-xs"
            style={{ color: 'var(--status-bar-warn-color-start-end)' }}
        >
            <AlertTriangle size={13} aria-hidden className="mt-px shrink-0" />
            <span>{message}</span>
        </p>
    );
}

/** What the pasted link turned out to be, and what will actually be fetched. Shown beside the URL
 *  box rather than rewritten into it, so the pasted link survives. */
function SourcePanel(props: { source: ModelSource | null; resolving: boolean }) {
    const { t } = useTranslation();
    const { source, resolving } = props;

    if (resolving) {
        return (
            <p className="flex items-center gap-1.5 pt-1 text-xs text-fg-soft">
                <Loader2 size={13} aria-hidden className="animate-spin" />
                {t('downloader.checking')}
            </p>
        );
    }
    if (!source || source.status === 'empty') {
        return null;
    }
    const Icon = source.ok ? CheckCircle2 : AlertTriangle;
    return (
        <div className="pt-1 text-xs">
            <p className="flex items-start gap-1.5" style={{ color: source.ok ? undefined : 'var(--backend-errored)' }}>
                <Icon size={13} aria-hidden className="mt-px shrink-0" />
                <span className={source.ok ? 'text-fg-soft' : ''}>
                    {t(`downloader.status.${source.status}`, { file: source.detail })}
                </span>
            </p>
            {source.ok && (
                <p className="mt-1 truncate font-mono text-fg-soft" title={source.downloadUrl}>
                    {t('downloader.downloadsFrom')} {source.downloadUrl}
                </p>
            )}
        </div>
    );
}

/** The model behind a Civitai link, so the user can see they are downloading what they meant to.
 *
 *  Version and file are pickers rather than plain text, because one Civitai page routinely holds
 *  several of each - a pruned and a full checkpoint, an fp8 and an fp16 - and a link only ever
 *  names one of them. */
function CivitaiCard(props: {
    info: CivitaiInfo;
    preview: Preview | null;
    index: number;
    onStep: (delta: number) => void;
    onPickVersion: (versionId: string) => void;
    onPickFile: (fileId: string) => void;
}) {
    const { t } = useTranslation();
    const { info, preview } = props;
    const total = info.previews.length;
    const file = info.files.find(entry => entry.id === info.fileId);
    const fileLabel = (option: { label: string; sizeKb: number | null }) =>
        option.sizeKb
            ? t('downloader.fileWithSize', { file: option.label, size: Math.round(option.sizeKb / 1024) })
            : option.label;

    return (
        <div className="mt-2 flex gap-3 rounded-lg border border-subtle bg-surface-sunken p-2.5">
            {preview && (
                <div className="w-28 shrink-0">
                    {preview.kind === 'video' ? (
                        <video
                            src={preview.url}
                            muted
                            loop
                            autoPlay
                            playsInline
                            className="w-full rounded border border-subtle"
                        />
                    ) : (
                        <img
                            src={preview.url}
                            alt={t('downloader.previewAlt', { model: info.modelName })}
                            className="w-full rounded border border-subtle"
                        />
                    )}
                    {total > 1 && (
                        <div className="mt-1 flex items-center justify-between">
                            <PreviewStep direction={-1} onStep={props.onStep} />
                            <span className="text-[11px] tabular-nums text-fg-soft">
                                {props.index + 1}/{total}
                            </span>
                            <PreviewStep direction={1} onStep={props.onStep} />
                        </div>
                    )}
                    <p className="mt-1 text-[11px] text-fg-soft">{t('downloader.thumbnailNote')}</p>
                </div>
            )}

            <div className="min-w-0 flex-1 text-xs">
                <a
                    href={info.pageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate text-sm font-medium text-fg-strong underline-offset-2 hover:underline"
                    title={info.modelName}
                >
                    {info.modelName}
                </a>
                {info.paidAccessEndsAt && (
                    <p className="mt-1 flex items-start gap-1.5" style={{ color: 'var(--backend-errored)' }}>
                        <AlertTriangle size={13} aria-hidden className="mt-px shrink-0" />
                        <span>
                            {t('downloader.paidAccess', { date: info.paidAccessEndsAt.split('T')[0] })}
                        </span>
                    </p>
                )}
                <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                    {info.versions.length > 1 ? (
                        <CardPicker
                            label={t('downloader.version')}
                            value={info.versionId}
                            options={info.versions.map(entry => ({ id: entry.id, label: entry.label }))}
                            onPick={props.onPickVersion}
                        />
                    ) : (
                        <CardRow label={t('downloader.version')} value={info.versionName} />
                    )}
                    <CardRow label={t('downloader.baseModel')} value={info.baseModel} />
                    <CardRow label={t('modelDetail.field.author')} value={info.author} />
                    <CardRow label={t('modelDetail.field.date')} value={info.date.split('T')[0]} />
                    <CardRow label={t('modelDetail.field.triggerPhrase')} value={info.triggerWords} />
                    {info.files.length > 1 ? (
                        <CardPicker
                            label={t('downloader.file')}
                            value={info.fileId}
                            options={info.files.map(entry => ({ id: entry.id, label: fileLabel(entry) }))}
                            onPick={props.onPickFile}
                        />
                    ) : (
                        <CardRow label={t('downloader.file')} value={file ? fileLabel(file) : ''} />
                    )}
                </dl>
                {(info.versionDescription || info.description) && (
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-fg-soft">
                        {info.versionDescription || info.description}
                    </p>
                )}
            </div>
        </div>
    );
}

/** A card row whose value is one of several the user can switch between. */
function CardPicker(props: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onPick: (id: string) => void;
}) {
    return (
        <>
            <dt className="text-fg-soft">{props.label}</dt>
            <dd className="min-w-0">
                <select
                    aria-label={props.label}
                    value={props.value}
                    onChange={event => props.onPick(event.target.value)}
                    className="w-full rounded border border-default bg-surface px-1 py-0.5 text-xs text-fg outline-none focus:border-[var(--emphasis)]"
                >
                    {props.options.map(option => (
                        <option key={option.id} value={option.id}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </dd>
        </>
    );
}

function CardRow(props: { label: string; value: string }) {
    if (!props.value) {
        return null;
    }
    return (
        <>
            <dt className="text-fg-soft">{props.label}</dt>
            <dd className="min-w-0 truncate text-fg" title={props.value}>
                {props.value}
            </dd>
        </>
    );
}

function PreviewStep(props: { direction: 1 | -1; onStep: (delta: number) => void }) {
    const { t } = useTranslation();
    const Icon = props.direction === 1 ? ChevronRight : ChevronLeft;
    return (
        <button
            type="button"
            onClick={() => props.onStep(props.direction)}
            aria-label={props.direction === 1 ? t('downloader.nextPreview') : t('downloader.previousPreview')}
            className="rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
        >
            <Icon size={13} aria-hidden />
        </button>
    );
}
