import { useEffect, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { usePermitted } from '@/api/permissions';
import { SECTIONS, defaultDestination } from '@/nav/destinations';
import { useTranslation } from '@/i18n';
import { useActiveSection } from './Rail';

/** Phone-width replacement for the rail.
 *
 * The rail is 4.5rem of permanently reserved width for five links — affordable beside a 1400px
 * workspace, not beside a 360px one. Folded into a drawer it costs one header button, and the
 * level-two nav stays on screen as the horizontal strip under the header, so the "where am I"
 * guarantee the rail exists to provide is not lost with it. */
export function NavDrawer() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const sections = usePermitted(SECTIONS);
    const activeSection = useActiveSection();
    const pathname = useRouterState({ select: s => s.location.pathname });

    // Navigating is the whole purpose of the drawer, so arriving somewhere dismisses it.
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
                <button
                    type="button"
                    aria-label={t('nav.openMenu')}
                    className="-ml-1 shrink-0 rounded p-2 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                >
                    <Menu size={18} aria-hidden />
                </button>
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col border-r border-default bg-surface shadow-2xl"
                >
                    <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-2">
                        <Dialog.Title className="flex-1 text-sm font-medium text-fg-strong">
                            {t('nav.breadcrumb.root')}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={t('common.close')}
                                className="rounded p-1 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                            >
                                <X size={16} aria-hidden />
                            </button>
                        </Dialog.Close>
                    </div>
                    <nav aria-label={t('nav.rail.primary')} className="min-h-0 flex-1 overflow-y-auto p-2">
                        {sections.map(section => {
                            const target = defaultDestination(section.id);
                            if (!target) {
                                return null;
                            }
                            const Icon = section.icon;
                            const isActive = activeSection === section.id;
                            return (
                                <Link
                                    key={section.id}
                                    to={target.path}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={[
                                        'flex items-center gap-2.5 rounded px-2 py-2.5 text-sm transition-colors',
                                        isActive
                                            ? 'bg-[var(--sw-active)] text-fg-strong'
                                            : 'text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg'
                                    ].join(' ')}
                                >
                                    <Icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
                                    <span className="truncate">{t(section.labelKey)}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
