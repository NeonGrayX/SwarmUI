import { Link, useRouterState } from '@tanstack/react-router';
import { usePermitted } from '@/api/permissions';
import { destinationsIn, findSection, type SectionId } from '@/nav/destinations';
import { useTranslation } from '@/i18n';

/** Level two of the IA: the destinations within the active rail section.
 *
 * Styled deliberately unlike the rail so the hierarchy is legible at a glance — the core problem
 * with the legacy UI, where the top strip and its sub-strips both rendered as `nav-tabs`.
 * Sections with a single destination render no nav at all. */
export function SectionNav(props: { section: SectionId }) {
    const { t } = useTranslation();
    const destinations = usePermitted(destinationsIn(props.section));
    const pathname = useRouterState({ select: s => s.location.pathname });
    const section = findSection(props.section);

    if (destinations.length < 2) {
        return null;
    }

    return (
        <nav
            aria-label={
                section ? t('nav.sectionNav.label', { section: t(section.labelKey) }) : t('nav.sectionNav.fallback')
            }
            className="flex flex-col gap-0.5 w-56 shrink-0 border-r border-subtle bg-surface p-2 overflow-y-auto"
        >
            {destinations.map(dest => {
                const Icon = dest.icon;
                const isActive = pathname === dest.path;
                return (
                    <Link
                        key={dest.id}
                        to={dest.path}
                        aria-current={isActive ? 'page' : undefined}
                        className={[
                            'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
                            isActive
                                ? 'bg-[var(--sw-active)] text-fg-strong'
                                : 'text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
                        ].join(' ')}
                    >
                        <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
                        <span className="truncate">{t(dest.labelKey)}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
