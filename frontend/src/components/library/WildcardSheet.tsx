import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { api } from '@/api/client';
import { useSaveWildcard, useWildcard } from '@/library/hooks';
import { isPlaceholderImage, previewUrl, type WildcardCard } from '@/library/types';
import { DetailSheet } from '../ui/DetailSheet';
import { KEEP_PREVIEW, PreviewImageEditor, previewValue, type PreviewChange } from './PreviewImageEditor';
import { useTranslation } from '@/i18n';

/** What a wildcard fills in as, one random pick per call - legacy's testWildcard
 *  (src/wwwroot/js/genpage/gentab/wildcards.js). */
async function testFill(name: string): Promise<string> {
    const result = await api.post<{ result: string }>('TestPromptFill', { prompt: `<wildcard:${name}>` });
    return result.result;
}

/** Side sheet for one wildcard: its whole text (the listing only carries the first 512
 *  characters), a test fill, and the way into the editor. */
export function WildcardSheet(props: {
    card: WildcardCard;
    canEdit: boolean;
    use?: { label: string; onUse: () => void };
    onEdit: () => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const full = useWildcard(props.card.name);
    const [test, setTest] = useState<{ result: string | null; error: string | null; running: boolean } | null>(null);

    useEffect(() => setTest(null), [props.card.name]);

    async function runTest(): Promise<void> {
        setTest(current => ({ result: current?.result ?? null, error: null, running: true }));
        try {
            setTest({ result: await testFill(props.card.name), error: null, running: false });
        }
        catch (e: unknown) {
            setTest({ result: null, error: e instanceof Error ? e.message : String(e), running: false });
        }
    }

    const image = isPlaceholderImage(props.card.image) ? undefined : previewUrl(props.card.image);
    const raw = full.data?.raw ?? props.card.raw;

    const buttonClass =
        'rounded border border-default px-2 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg disabled:opacity-40';

    return (
        <DetailSheet label={t('wildcard.details')} onClose={props.onClose}>
            <div className="flex shrink-0 items-start gap-2 border-b border-subtle p-3">
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-medium text-fg-strong" title={props.card.name}>
                        {props.card.name.split('/').pop()}
                    </h2>
                    <p className="truncate font-mono text-[11px] text-fg-soft" title={props.card.name}>
                        {props.card.name}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={props.onClose}
                    aria-label={t('common.closeDetails')}
                    className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <X size={15} aria-hidden />
                </button>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 border-b border-subtle px-3 py-2">
                {props.use && (
                    <button
                        type="button"
                        onClick={props.use.onUse}
                        className="rounded px-2 py-1 text-xs"
                        style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                    >
                        {props.use.label}
                    </button>
                )}
                <button type="button" onClick={() => void runTest()} disabled={test?.running} className={buttonClass}>
                    {test ? t('wildcard.testAgain') : t('wildcard.test')}
                </button>
                {props.canEdit && (
                    <>
                        <button type="button" onClick={props.onEdit} className={buttonClass}>
                            {t('wildcard.edit')}
                        </button>
                        <button
                            type="button"
                            onClick={props.onDelete}
                            className={buttonClass}
                            style={{ color: 'var(--backend-errored)' }}
                        >
                            {t('common.delete')}
                        </button>
                    </>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {image && (
                    <img src={image} alt="" className="mb-3 max-h-48 w-full rounded border border-subtle object-cover" />
                )}
                {test && (
                    <div className="mb-3">
                        <h3 className="mb-1 text-xs uppercase tracking-wide text-fg-soft">{t('wildcard.testResult')}</h3>
                        {test.running && test.result === null ? (
                            <Loader2 size={14} className="animate-spin text-fg-soft" aria-hidden />
                        ) : test.error ? (
                            <p className="text-xs" style={{ color: 'var(--backend-errored)' }}>
                                {test.error}
                            </p>
                        ) : (
                            <p className="whitespace-pre-wrap break-words rounded border border-subtle bg-surface-sunken p-2 text-sm text-fg">
                                {test.result}
                            </p>
                        )}
                    </div>
                )}
                <h3 className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-fg-soft">
                    {t('modelDetail.wildcardEntries')}
                    {full.isFetching && <Loader2 size={11} className="animate-spin" aria-hidden />}
                </h3>
                {full.isError && (
                    <p className="mb-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                        {full.error instanceof Error ? full.error.message : t('wildcard.loadFailed')}
                    </p>
                )}
                <pre className="whitespace-pre-wrap break-words rounded border border-subtle bg-surface-sunken p-2 font-mono text-[11px] text-fg-soft">
                    {raw || t('modelDetail.wildcardEmpty')}
                </pre>
            </div>
        </DetailSheet>
    );
}

/** Which wildcard the editor is open on: an existing one by name, or a new one starting in a
 *  folder. */
export type WildcardEditTarget = { kind: 'edit'; name: string } | { kind: 'new'; folder: string };

/** Creating and editing a wildcard, as legacy's edit_wildcard_modal. Saving under another name moves
 *  it there (see useSaveWildcard). */
export function WildcardEditorDialog(props: {
    target: WildcardEditTarget | null;
    onClose: () => void;
    onSaved: (name: string) => void;
}) {
    const { t } = useTranslation();
    const existing = props.target?.kind === 'edit' ? props.target.name : null;
    const full = useWildcard(existing);
    const save = useSaveWildcard();
    const [name, setName] = useState('');
    const [content, setContent] = useState('');
    const [preview, setPreview] = useState<PreviewChange>(KEEP_PREVIEW);
    const [error, setError] = useState<string | null>(null);
    const [loadedFor, setLoadedFor] = useState<WildcardEditTarget | null>(null);

    // Filled once per opening - from the full text for an edit, which the listing cuts short - and
    // then left to the user, so a refetch does not overwrite what is being typed.
    const ready = props.target !== null && (props.target.kind === 'new' || full.data !== undefined);
    if (props.target !== loadedFor && ready && props.target) {
        setLoadedFor(props.target);
        setError(null);
        setPreview(KEEP_PREVIEW);
        if (props.target.kind === 'new') {
            setName(props.target.folder ? `${props.target.folder}/` : '');
            setContent('');
        }
        else {
            setName(full.data?.name ?? props.target.name);
            setContent(full.data?.raw ?? '');
        }
    }
    if (props.target === null && loadedFor !== null) {
        setLoadedFor(null);
    }

    async function submit(): Promise<void> {
        setError(null);
        const card = name.trim().replaceAll('\\', '/').replace(/^\/+/, '');
        if (!card) {
            setError(t('wildcard.error.nameRequired'));
            return;
        }
        if (card.endsWith('/')) {
            setError(t('wildcard.error.nameIsFolder'));
            return;
        }
        const options = content.trimEnd();
        if (!options) {
            setError(t('wildcard.error.contentRequired'));
            return;
        }
        try {
            await save.mutateAsync({
                card,
                options,
                previewImage: previewValue(preview),
                previousName: existing ?? undefined
            });
            props.onSaved(card);
        }
        catch (e: unknown) {
            setError(e instanceof Error ? e.message : t('wildcard.error.saveFailed'));
        }
    }

    const inputClass =
        'w-full rounded border border-default bg-surface-sunken px-2 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

    return (
        <Dialog.Root open={props.target !== null} onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(40rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl">
                    <div className="shrink-0 border-b border-subtle px-4 py-3">
                        <Dialog.Title className="text-base font-medium text-fg-strong">
                            {props.target?.kind === 'new' ? t('wildcard.createTitle') : t('wildcard.editTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="mt-0.5 text-xs text-fg-soft">
                            {t('wildcard.editorHint')}
                        </Dialog.Description>
                    </div>
                    {!ready ? (
                        <div className="flex items-center gap-2 p-4 text-sm text-fg-soft">
                            {full.isError ? (
                                <span style={{ color: 'var(--backend-errored)' }}>
                                    {full.error instanceof Error ? full.error.message : t('wildcard.loadFailed')}
                                </span>
                            ) : (
                                <>
                                    <Loader2 size={14} className="animate-spin" aria-hidden />
                                    {t('common.loading')}
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                            <label className="block text-xs text-fg-soft">
                                {t('wildcard.name')}
                                <input
                                    type="text"
                                    value={name}
                                    autoFocus
                                    onChange={e => setName(e.target.value)}
                                    className={`${inputClass} mt-1 font-mono`}
                                />
                            </label>
                            <label className="block text-xs text-fg-soft">
                                {t('wildcard.options')}
                                <textarea
                                    rows={14}
                                    value={content}
                                    onChange={e => setContent(e.target.value)}
                                    placeholder={t('wildcard.optionsPlaceholder')}
                                    className={`${inputClass} mt-1 resize-y font-mono`}
                                />
                            </label>
                            <div className="text-xs text-fg-soft">
                                <p className="mb-1">{t('modelDetail.field.preview')}</p>
                                <PreviewImageEditor
                                    current={props.target?.kind === 'edit' ? full.data?.image : null}
                                    value={preview}
                                    onChange={setPreview}
                                />
                            </div>
                        </div>
                    )}
                    <div className="shrink-0 border-t border-subtle px-4 py-3">
                        {error && (
                            <p className="mb-2 text-xs" style={{ color: 'var(--backend-errored)' }}>
                                {error}
                            </p>
                        )}
                        <div className="flex justify-end gap-2">
                            <Dialog.Close asChild>
                                <button
                                    type="button"
                                    className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    {t('common.cancel')}
                                </button>
                            </Dialog.Close>
                            <button
                                type="button"
                                disabled={!ready || save.isPending}
                                onClick={() => void submit()}
                                className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                            >
                                {save.isPending ? t('common.saving') : t('common.save')}
                            </button>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
