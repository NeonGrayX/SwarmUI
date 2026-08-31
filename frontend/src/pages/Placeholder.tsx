import { Construction } from 'lucide-react';
import type { Destination } from '@/nav/destinations';
import { useTranslation } from '@/i18n';

/** Stand-in for a routed destination with no screen of its own — Extensions is the only one.
 *  `summaryKey` names the translated one-line description in router.tsx. */
export function Placeholder(props: { destination: Destination; summaryKey?: string }) {
    const { t } = useTranslation();
    const Icon = props.destination.icon;
    return (
        <div className="p-8 max-w-2xl">
            <div className="flex items-center gap-2 mb-1">
                <Icon size={20} className="text-fg-soft" aria-hidden />
                <h1 className="text-xl font-semibold text-fg-strong">{t(props.destination.labelKey)}</h1>
            </div>
            {props.summaryKey && <p className="text-fg-soft mb-6">{t(props.summaryKey)}</p>}
            <div className="flex items-start gap-3 rounded-lg border border-default bg-surface p-4">
                <Construction size={18} className="mt-0.5 shrink-0 text-fg-soft" aria-hidden />
                <div>
                    <p className="text-fg">{t('placeholder.notBuilt')}</p>
                    <p className="text-sm text-fg-soft mt-1">
                        {t('placeholder.useLegacyBefore')}{' '}
                        <a href="/Text2Image" className="underline" style={{ color: 'var(--emphasis)' }}>
                            /Text2Image
                        </a>
                        {t('placeholder.useLegacyAfter')}
                    </p>
                </div>
            </div>
        </div>
    );
}
