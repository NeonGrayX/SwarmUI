import type { ReactNode } from 'react';
import { Outlet } from '@tanstack/react-router';
import { Rail, useActiveSection } from './Rail';
import { SectionNav } from './SectionNav';
import { Breadcrumbs } from './Breadcrumbs';
import { GenerationCounters, StatusAlert } from './StatusAlert';
import { CommandPalette, CommandPaletteHint } from '../CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useSession } from '@/api/hooks';
import { useThemes } from '@/theme/useTheme';

/** The whole-app chrome: rail (level 1) + section nav (level 2) + content.
 *  Nothing nests deeper than this. */
export function AppShell() {
    const session = useSession();
    const section = useActiveSection();
    // Applied at the shell so the theme is reconciled on every screen, not only in Appearance.
    useThemes();

    if (session.isPending) {
        return <Splash>Connecting to SwarmUI…</Splash>;
    }
    if (session.isError) {
        return (
            <Splash tone="error">
                Couldn't reach the SwarmUI server.
                <div className="mt-2 text-sm text-fg-soft">
                    {session.error instanceof Error ? session.error.message : String(session.error)}
                </div>
            </Splash>
        );
    }

    return (
        <div className="flex h-full overflow-hidden">
            <Rail />
            {section && <SectionNav section={section} />}
            <div className="flex flex-col flex-1 min-w-0">
                <header
                    className="flex items-center gap-3 px-4 border-b border-subtle shrink-0"
                    style={{ height: 'var(--sw-header-height)' }}
                >
                    <Breadcrumbs />
                    <div className="flex-1" />
                    <GenerationCounters />
                    <CommandPaletteHint />
                </header>
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
