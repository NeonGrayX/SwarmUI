import { Construction } from 'lucide-react';
import type { Destination } from '@/nav/destinations';
import { useTranslation } from '@/i18n';

/** Honest placeholder for a destination that is routed but not yet built.
 *  Says which phase delivers it rather than pretending to be an empty screen.
 *
 *  `phase` and `summary` come from the build plan in router.tsx and are deliberately not
 *  translated: they are developer-facing notes about work in progress. Extensions is the only
 *  destination that still lands here, and it points at the legacy Extensions tab. */
export function Placeholder(props: { destination: Destination; phase: string; summary: string }) {
    const { t } = useTranslation();
    const Icon = props.destination.icon;
    return (
        <div className="p-8 max-w-2xl">
            <div className="flex items-center gap-2 mb-1">
                <Icon size={20} className="text-fg-soft" aria-hidden />
                <h1 className="text-xl font-semibold text-fg-strong">{t(props.destination.labelKey)}</h1>
            </div>
            <p className="text-fg-soft mb-6">{props.summary}</p>
            <div className="flex items-start gap-3 rounded-lg border border-default bg-surface p-4">
                <Construction size={18} className="mt-0.5 shrink-0 text-fg-soft" aria-hidden />
                <div>
                    <p className="text-fg">{t('placeholder.notBuilt', { phase: props.phase })}</p>
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
