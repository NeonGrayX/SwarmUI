import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { DownloaderWarning, useDownloaderForm } from '../tools/DownloaderForm';
import { JobPanel, ToolWarning } from '../tools/ToolLayout';
import { useTranslation } from '@/i18n';

/** The Model Downloader, raised over a Library browser.
 *
 * This is the same form and the same job store as the downloader tool page, so a download started
 * here shows its progress in both places, keeps running when this closes, and can be cancelled
 * from either. The Tasks panel at the bottom is that store — every job, not just the ones started
 * from this window. */
export function DownloadModelDialog(props: {
    open: boolean;
    /** Library category the browser is showing, which is what the type picker opens on. */
    subtype: string;
    /** Folder currently browsed, offered as the save location when the type still has it. */
    folder: string;
    onClose: () => void;
}) {
    const { t } = useTranslation();

    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(42rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl">
                    <div className="flex shrink-0 items-start gap-2 border-b border-subtle px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <Dialog.Title className="text-base font-medium text-fg-strong">
                                {t('nav.destination.downloader')}
                            </Dialog.Title>
                            <Dialog.Description className="mt-0.5 text-sm text-fg-soft">
                                {t('downloader.summary')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={t('common.close')}
                                className="shrink-0 rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                <X size={15} aria-hidden />
                            </button>
                        </Dialog.Close>
                    </div>

                    {/* Only mounted while open — closing throws the form away (the job it started
                        lives on in the store) rather than leaving its lookups polling. */}
                    <DownloadForm subtype={props.subtype} folder={props.folder} />

                    <JobPanel onNavigate={props.onClose} />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function DownloadForm(props: { subtype: string; folder: string }) {
    const { t } = useTranslation();
    const form = useDownloaderForm({ initialType: props.subtype, initialFolder: props.folder });

    return (
        <>
            <div
                className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
                style={{ ['--sw-field-label-width' as string]: '9rem' }}
            >
                {form.fields}
                <ToolWarning className="mt-3">
                    <DownloaderWarning />
                </ToolWarning>
                <p className="mt-2 text-xs text-fg-soft">{t('downloader.dialogNote')}</p>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-subtle px-4 py-3">
                <Dialog.Close asChild>
                    <button
                        type="button"
                        className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                    >
                        {t('common.close')}
                    </button>
                </Dialog.Close>
                <button
                    type="button"
                    disabled={!form.canRun}
                    onClick={form.start}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {t('downloader.startDownload')}
                </button>
            </div>
        </>
    );
}
