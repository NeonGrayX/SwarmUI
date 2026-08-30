import { ToolLayout } from '@/components/tools/ToolLayout';
import { DownloaderWarning, useDownloaderForm } from '@/components/tools/DownloaderForm';
import { useTranslation } from '@/i18n';

/** The downloader as a full tool screen. The form itself is shared with the popup the Library
 *  raises (src/components/library/DownloadModelDialog.tsx); this page is the frame around it. */
export function DownloaderPage() {
    const { t } = useTranslation();
    const form = useDownloaderForm();

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
            warning={<DownloaderWarning />}
            action={
                <button
                    type="button"
                    disabled={!form.canRun}
                    onClick={form.start}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {t('downloader.startDownload')}
                </button>
            }
        >
            {form.fields}
        </ToolLayout>
    );
}
