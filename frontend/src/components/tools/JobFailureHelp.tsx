import { Link } from '@tanstack/react-router';
import { ExternalLink, KeyRound } from 'lucide-react';
import { readDownloadAuthFailure } from '@/tools/downloadFailure';
import { useTranslation } from '@/i18n';

/** What to do about a download the host refused.
 *
 * A 401 or 403 under a job is the one failure the user can nearly always fix, and fixing it means
 * leaving this screen: a gated Hugging Face repo wants its conditions accepted on the model page,
 * and a missing key wants the Account settings. Both are one click from here; without them the
 * error is a dead end that reads like a broken link. Renders nothing for any other failure. */
export function JobFailureHelp(props: { error: string | undefined; onNavigate?: () => void }) {
    const { t } = useTranslation();
    const failure = readDownloadAuthFailure(props.error);

    if (!failure) {
        return null;
    }

    const status = failure.status ?? 401;
    const advice =
        failure.host === 'huggingface'
            ? status === 403
                ? t('downloadHelp.huggingfaceGated')
                : t('downloadHelp.huggingfaceUnauthorized')
            : failure.host === 'civitai'
              ? t('downloadHelp.civitai', { status })
              : t('downloadHelp.generic', { status });

    return (
        <div
            className="mt-1.5 rounded border p-2"
            style={{
                borderColor: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 45%, transparent)',
                background: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 12%, transparent)'
            }}
        >
            <p className="text-xs text-fg">{advice}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                {failure.modelPage && (
                    <a
                        href={failure.modelPage}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-xs underline"
                        style={{ color: 'var(--emphasis)' }}
                    >
                        <ExternalLink size={11} aria-hidden />
                        {t('downloadHelp.openModelPage')}
                    </a>
                )}
                <Link
                    to="/settings/account"
                    onClick={() => props.onNavigate?.()}
                    className="inline-flex items-center gap-1 text-xs underline"
                    style={{ color: 'var(--emphasis)' }}
                >
                    <KeyRound size={11} aria-hidden />
                    {t('downloadHelp.setApiKey')}
                </Link>
            </div>
        </div>
    );
}
