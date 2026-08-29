import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { queryKeys } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { subtypeNoun } from '@/library/catalog';
import { useParamSchema } from '@/params/schema';
import {
    folderOptions,
    LIBRARY_SUBTYPES,
    previewToThumbnail,
    resolveModelSource,
    type CivitaiInfo,
    type ModelSource,
    type Preview
} from '@/tools/modelSource';
import { useJobStore } from '@/tools/jobs';
import { hasTranslation, useTranslation, type Translator } from '@/i18n';

const INPUT_CLASS =
    'w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

/** How long to sit on a keystroke before asking Civitai about the link. */
const LOOKUP_DEBOUNCE_MS = 400;

/** Display name of a subtype. The five Library categories get their own singular labels, since
 *  'Base Model' reads better in a picker than the internal id 'Stable-Diffusion'; anything else
 *  falls back to the same noun the Library and the model pickers use. */
function subtypeLabel(subtype: string, t: Translator['t']): string {
    const key = `downloader.type.${subtype}`;
    return hasTranslation(key) ? t(key) : subtypeNoun(subtype);
}

export function DownloaderPage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const schema = useParamSchema();
    // The Civitai lookup runs through ForwardMetadataRequest, which is gated on this permission.
    const canLookup = usePermission('edit_model_metadata');
    const run = useJobStore(s => s.run);

    const [url, setUrl] = useState('');
    const [type, setType] = useState('Stable-Diffusion');
    const [folder, setFolder] = useState('');
    const [name, setName] = useState('');
    // Suggestions stop filling a field once the user has taken it over, and start again when the
    // URL changes to point at a different model.
    const [nameEdited, setNameEdited] = useState(false);
    const [typeEdited, setTypeEdited] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [thumbnail, setThumbnail] = useState<string | null>(null);

    const trimmedUrl = url.trim();
    const [lookupUrl, setLookupUrl] = useState('');
    useEffect(() => {
        // Debounced, or a Civitai link would cost one API round trip per character typed.
        const timer = setTimeout(() => setLookupUrl(trimmedUrl), LOOKUP_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [trimmedUrl]);

    const lookup = useQuery({
        queryKey: ['model-source', lookupUrl, canLookup],
        queryFn: () => resolveModelSource(lookupUrl, canLookup),
        enabled: lookupUrl.length > 0,
        staleTime: 5 * 60 * 1000,
        retry: false
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
    }, [folders, folder]);

    const extraTypes = useMemo(
        () => Object.keys(schema?.models ?? {}).filter(key => !LIBRARY_SUBTYPES.includes(key)).sort(),
        [schema]
    );

    const cleanName = name.trim().replace(/\s+/g, '_');
    const fullName = folder ? `${folder}/${cleanName}` : cleanName;
    // Matches the server's own choice of extension (ModelsAPI.cs:597).
    const extension = source?.downloadUrl.endsWith('.gguf') ? 'gguf' : 'safetensors';
    const canRun = Boolean(source?.ok) && cleanName.length > 0;

    function startDownload() {
        if (!source) {
            return;
        }
        const metadata = source.metadata
            ? JSON.stringify(thumbnail ? { ...source.metadata, 'modelspec.thumbnail': thumbnail } : source.metadata, null, 2)
            : undefined;
        run({
            title: t('downloader.jobTitle', { type: subtypeLabel(type, t), name: fullName }),
            route: 'DoModelDownloadWS',
            payload: { url: source.downloadUrl, type, name: fullName, metadata },
            onDone: () => {
                // The model exists now; the Library and every model picker are a refresh behind.
                queryClient.invalidateQueries({ queryKey: ['models'] });
                queryClient.invalidateQueries({ queryKey: queryKeys.t2iParams });
            }
        });
    }

    return (
        <ToolLayout
            title={t('nav.destination.downloader')}
            summary={t('downloader.summary')}
            about={
                <>
                    <p>{t('downloader.about1')}</p>
                    <p>{t('downloader.about2')}</p>
                    <p>
                        {t('downloader.about3Before')}{' '}
                        <a href="/Text2Image" className="underline" style={{ color: 'var(--emphasis)' }}>
                            /Text2Image
                        </a>{' '}
                        {t('downloader.about3After')}
                    </p>
                </>
            }
            warning={
                <>
                    {t('downloader.warningBefore')} <code className="font-mono">.ckpt</code>{' '}
                    {t('downloader.warningAfter')}
                </>
            }
            action={
                <button
                    type="button"
                    disabled={!canRun}
                    onClick={startDownload}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {t('downloader.startDownload')}
                </button>
            }
        >
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
                />
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
                    onChange={e => setFolder(e.target.value)}
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
                    {t('downloader.savesTo', {
                        type: subtypeLabel(type, t),
                        path: `${fullName}.${extension}`
                    })}
                </p>
            )}
        </ToolLayout>
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

/** The model behind a Civitai link, so the user can see they are downloading what they meant to. */
function CivitaiCard(props: {
    info: CivitaiInfo;
    preview: Preview | null;
    index: number;
    onStep: (delta: number) => void;
}) {
    const { t } = useTranslation();
    const { info, preview } = props;
    const total = info.previews.length;

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
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                    <CardRow label={t('downloader.version')} value={info.versionName} />
                    <CardRow label={t('downloader.baseModel')} value={info.baseModel} />
                    <CardRow label={t('modelDetail.field.author')} value={info.author} />
                    <CardRow label={t('modelDetail.field.date')} value={info.date.split('T')[0]} />
                    <CardRow label={t('modelDetail.field.triggerPhrase')} value={info.triggerWords} />
                    <CardRow
                        label={t('downloader.file')}
                        value={
                            info.fileSizeKb
                                ? t('downloader.fileWithSize', {
                                      file: info.fileName,
                                      size: Math.round(info.fileSizeKb / 1024)
                                  })
                                : info.fileName
                        }
                    />
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
