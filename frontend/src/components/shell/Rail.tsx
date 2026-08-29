import { Link, useRouterState } from '@tanstack/react-router';
import * as Tooltip from '@radix-ui/react-tooltip';
import { usePermitted } from '@/api/permissions';
import { SECTIONS, defaultDestination, type SectionId } from '@/nav/destinations';
import { useTranslation } from '@/i18n';

/** The always-visible primary navigation: level one of the IA, which never scrolls away and never
 *  changes, so "where am I" is always answerable. Folds into <NavDrawer> below `md`. */
export function Rail() {
    const { t } = useTranslation();
    const sections = usePermitted(SECTIONS);
    const activeSection = useActiveSection();

    return (
        <Tooltip.Provider delayDuration={300}>
            <nav
                aria-label={t('nav.rail.primary')}
                className="flex flex-col items-center gap-1 py-3 border-r border-subtle bg-surface-sunken shrink-0"
                style={{ width: 'var(--sw-rail-width)' }}
            >
                {sections.map(section => {
                    const target = defaultDestination(section.id);
                    if (!target) {
                        return null;
                    }
                    const Icon = section.icon;
                    const label = t(section.labelKey);
                    const isActive = activeSection === section.id;
                    return (
                        <Tooltip.Root key={section.id}>
                            <Tooltip.Trigger asChild>
                                <Link
                                    to={target.path}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={[
                                        'group flex flex-col items-center gap-1 w-14 py-2 rounded transition-colors',
                                        isActive
                                            ? 'text-fg-strong bg-[var(--sw-active)]'
                                            : 'text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]'
                                    ].join(' ')}
                                >
                                    <Icon size={20} strokeWidth={1.75} aria-hidden />
                                    <span className="text-[10px] leading-none">{label}</span>
                                </Link>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                                <Tooltip.Content
                                    side="right"
                                    sideOffset={8}
                                    className="rounded bg-surface-raised border border-default px-2 py-1 text-xs text-fg shadow-lg"
                                >
                                    {label}
                                </Tooltip.Content>
                            </Tooltip.Portal>
                        </Tooltip.Root>
                    );
                })}
            </nav>
        </Tooltip.Provider>
    );
}

/** Derives the active rail section from the current path's first segment. */
export function useActiveSection(): SectionId | undefined {
    const pathname = useRouterState({ select: s => s.location.pathname });
    const first = pathname.split('/').filter(Boolean)[0];
    return SECTIONS.find(s => s.id === first)?.id;
}
