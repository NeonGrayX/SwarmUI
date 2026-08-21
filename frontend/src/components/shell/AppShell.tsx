import type { ReactNode } from 'react';
import { Outlet } from '@tanstack/react-router';
import { Rail, useActiveSection } from './Rail';
import { SectionNav } from './SectionNav';
import { NavDrawer } from './NavDrawer';
import { Breadcrumbs } from './Breadcrumbs';
import { GenerationCounters, StatusAlert } from './StatusAlert';
import { CommandPalette, CommandPaletteHint } from '../CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useSession } from '@/api/hooks';
import { useIsCompact, useIsMobile } from '@/shell/viewport';
import { useThemes } from '@/theme/useTheme';
import { useTranslation, useTranslationSync } from '@/i18n';

/** The whole-app chrome: rail (level 1) + section nav (level 2) + content.
 *  Nothing nests deeper than this. */
export function AppShell() {
    const { t } = useTranslation();
    const session = useSession();
    const section = useActiveSection();
    // Two thresholds, because the two nav levels stop fitting at different widths: the level-two
    // column goes horizontal as soon as a second content pane would not fit beside it, while the
    // rail survives until there is no width to spare at all.
    const compact = useIsCompact();
    const mobile = useIsMobile();
    // Applied at the shell so the theme is reconciled on every screen, not only in Appearance.
    useThemes();
    // Likewise for translations: this pulls the server-side string table and honours the language
    // stored in the user's profile, on every screen rather than only in Settings.
    useTranslationSync();

    if (session.isPending) {
        return <Splash>{t('shell.connecting')}</Splash>;
    }
    if (session.isError) {
        return (
            <Splash tone="error">
                {t('shell.unreachable')}
                <div className="mt-2 text-sm text-fg-soft">
                    {session.error instanceof Error ? session.error.message : String(session.error)}
                </div>
            </Splash>
        );
    }

    return (
        <div className="flex h-full overflow-hidden">
            {!mobile && <Rail />}
            {section && !compact && <SectionNav section={section} />}
            <div className="flex flex-col flex-1 min-w-0">
                <header
                    className="flex items-center gap-2 px-3 sm:gap-3 sm:px-4 border-b border-subtle shrink-0"
                    style={{ height: 'var(--sw-header-height)' }}
                >
                    {mobile && <NavDrawer />}
                    <Breadcrumbs />
                    <div className="flex-1" />
                    <GenerationCounters />
                    {/* A keyboard-shortcut hint is dead weight on a device with no keyboard. */}
                    {!mobile && <CommandPaletteHint />}
                </header>
                {section && compact && <SectionNav section={section} orientation="horizontal" />}
                <StatusAlert />
                <main className="flex-1 min-h-0 overflow-auto">
                    <Outlet />
                </main>
            </div>
            <CommandPalette />
            <ShortcutsDialog />
        </div>
    );
}

function Splash(props: { children: ReactNode; tone?: 'error' }) {
    return (
        <div className="flex h-full items-center justify-center p-8">
            <div
                className="text-center"
                style={{ color: props.tone === 'error' ? 'var(--backend-errored)' : 'var(--sw-fg-soft)' }}
            >
                {props.children}
            </div>
        </div>
    );
}
