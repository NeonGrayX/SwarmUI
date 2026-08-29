import { Link, useRouterState } from '@tanstack/react-router';
import { usePermitted } from '@/api/permissions';
import { destinationsIn, findSection, type SectionId } from '@/nav/destinations';
import { useTranslation } from '@/i18n';

/** Level two of the IA: the destinations within the active rail section. Styled deliberately
 *  unlike the rail, so the hierarchy is legible at a glance. Sections with a single destination
 *  render no nav at all.
 *
 *  Below `lg` the column becomes a horizontal strip under the header — one 40px row that scrolls
 *  sideways, which is what keeps this level out of the drawer on a phone. */
export function SectionNav(props: { section: SectionId; orientation?: 'vertical' | 'horizontal' }) {
    const { t } = useTranslation();
    const destinations = usePermitted(destinationsIn(props.section));
    const pathname = useRouterState({ select: s => s.location.pathname });
    const section = findSection(props.section);
    const horizontal = props.orientation === 'horizontal';

    if (destinations.length < 2) {
        return null;
    }

    return (
        <nav
            aria-label={
                section ? t('nav.sectionNav.label', { section: t(section.labelKey) }) : t('nav.sectionNav.fallback')
            }
            className={
                horizontal
                    ? 'sw-no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-subtle bg-surface px-2 py-1.5'
                    : 'flex flex-col gap-0.5 w-56 shrink-0 border-r border-subtle bg-surface p-2 overflow-y-auto'
            }
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
                            'flex items-center gap-2 rounded text-sm transition-colors',
                            horizontal ? 'shrink-0 whitespace-nowrap px-2.5 py-1.5' : 'px-2 py-1.5',
                            isActive
                                ? 'bg-[var(--sw-active)] text-fg-strong'
                                : 'text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
                        ].join(' ')}
                    >
                        <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
                        <span className={horizontal ? '' : 'truncate'}>{t(dest.labelKey)}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
