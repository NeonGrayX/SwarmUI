import { useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { findDestinationByPath, findSection } from '@/nav/destinations';

/** Shows rail section → destination. The legacy UI had no location indicator at all beyond two
 *  bolded tab labels in visually identical strips. */
export function Breadcrumbs() {
    const pathname = useRouterState({ select: s => s.location.pathname });
    const destination = findDestinationByPath(pathname);
    const section = destination ? findSection(destination.section) : undefined;

    if (!destination || !section) {
        return <span className="font-medium text-fg-strong">SwarmUI</span>;
    }

    return (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm min-w-0">
            <span className="text-fg-soft shrink-0">{section.label}</span>
            <ChevronRight size={14} className="text-fg-soft shrink-0" aria-hidden />
            <span className="font-medium text-fg-strong truncate">{destination.label}</span>
        </nav>
    );
}
