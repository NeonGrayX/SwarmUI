import { useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { findDestinationByPath, findSection } from '@/nav/destinations';
import { useTranslation } from '@/i18n';

/** Shows rail section → destination. The legacy UI had no location indicator at all beyond two
 *  bolded tab labels in visually identical strips. */
export function Breadcrumbs() {
    const { t } = useTranslation();
    const pathname = useRouterState({ select: s => s.location.pathname });
    const destination = findDestinationByPath(pathname);
    const section = destination ? findSection(destination.section) : undefined;

    if (!destination || !section) {
        return <span className="font-medium text-fg-strong">{t('nav.breadcrumb.root')}</span>;
    }

    return (
        <nav aria-label={t('nav.breadcrumb.label')} className="flex items-center gap-1 text-sm min-w-0">
            {/* The section is one tap away in the drawer on a phone, and the level-two strip sits
                directly under this row, so the trail collapses to just where you are. */}
            <span className="hidden sm:inline text-fg-soft shrink-0">{t(section.labelKey)}</span>
            <ChevronRight size={14} className="hidden sm:inline text-fg-soft shrink-0" aria-hidden />
            <span className="font-medium text-fg-strong truncate">{t(destination.labelKey)}</span>
        </nav>
    );
}
