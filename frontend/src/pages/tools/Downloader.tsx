import { useState } from 'react';
import { useT2IParams, useSession } from '@/api/hooks';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { useJobStore } from '@/tools/jobs';
import { useTranslation } from '@/i18n';

export function DownloaderPage() {
    const { t } = useTranslation();
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const run = useJobStore(s => s.run);

    const [url, setUrl] = useState('');
    const [type, setType] = useState('Stable-Diffusion');
    const [name, setName] = useState('');

    const modelTypes = Object.keys(params.data?.models ?? {});
    const canRun = url.trim().startsWith('http') && name.trim().length > 0;

    /** Suggests a filename from the URL when the user hasn't set one. */
    function autoName(nextUrl: string) {
        setUrl(nextUrl);
        if (!name.trim()) {
            const guess = nextUrl.split('?')[0].split('/').filter(Boolean).pop() ?? '';
            if (guess && /\.(safetensors|ckpt|pt|gguf|sft)$/i.test(guess)) {
                setName(guess.replace(/\.[^.]+$/, ''));
            }
        }
    }

    return (
        <ToolLayout
            title={t('nav.destination.downloader')}
            summary={t('downloader.summary')}
            about={
                <>
                    <p>{t('downloader.about1')}</p>
                    <p>{t('downloader.about2')}</p>
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
                    onClick={() =>
                        run({
                            title: t('downloader.jobTitle', { type, name: name.trim() }),
                            route: 'DoModelDownloadWS',
                            payload: { url: url.trim(), type, name: name.trim() }
                        })
                    }
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
                    onChange={e => autoName(e.target.value)}
                    placeholder="https://…"
                    className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />
            </Field>

            <Field id="dl-type" label={t('pickle2st.modelType')} density="compact">
                <select
                    id="dl-type"
                    value={type}
                    onChange={e => setType(e.target.value)}
                    className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                >
                    {(modelTypes.length > 0 ? modelTypes : ['Stable-Diffusion']).map(option => (
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
                    onChange={e => setName(e.target.value)}
                    placeholder={t('downloader.namePlaceholder')}
                    className="w-full rounded border border-default bg-surface-sunken px-2 py-1 font-mono text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />
            </Field>
        </ToolLayout>
    );
}
