import { useEffect, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Outlet } from '@tanstack/react-router';
import { Rail, useActiveSection } from './Rail';
import { SectionNav } from './SectionNav';
import { NavDrawer } from './NavDrawer';
import { Breadcrumbs } from './Breadcrumbs';
import { GenerationCounters, StatusAlert } from './StatusAlert';
import { CommandPalette, CommandPaletteHint } from '../CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { AccountMenu, ImpersonationBanner } from './AccountMenu';
import { useCurrentStatus, useSession } from '@/api/hooks';
import { useApiNotices } from '@/api/notices';
import { useRunProgress } from '@/generate/store';
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
                <button
                    type="button"
                    onClick={() => void session.refetch()}
                    disabled={session.isFetching}
                    className="mt-4 inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm disabled:opacity-60"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    <RefreshCw size={14} className={session.isFetching ? 'animate-spin' : ''} aria-hidden />
                    {t('shell.retry')}
                </button>
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
                    <AccountMenu compact={mobile} />
                </header>
                {section && compact && <SectionNav section={section} orientation="horizontal" />}
                <ServerUpdatedNotice />
                <ImpersonationBanner />
                <StatusAlert />
                <main className="flex-1 min-h-0 overflow-auto">
                    <Outlet />
                </main>
            </div>
            <CommandPalette />
            <ShortcutsDialog />
            <ProgressTitle />
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

/** Asks for a reload once the server is running a different build than this page loaded against
 *  (the legacy page's "server has updated" error, site.js getSession). */
function ServerUpdatedNotice() {
    const { t } = useTranslation();
    const updated = useApiNotices(s => s.serverUpdated);
    const dismiss = useApiNotices(s => s.dismissServerUpdated);
    if (!updated) {
        return null;
    }
    return (
        <div
            role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm text-fg"
            style={{
                background: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 18%, transparent)',
                borderColor: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 40%, transparent)'
            }}
        >
            <span className="flex-1">{t('shell.serverUpdated')}</span>
            <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded border border-default px-2 py-0.5 text-xs hover:bg-[var(--sw-hover)]"
            >
                {t('common.reload')}
            </button>
            <button
                type="button"
                onClick={dismiss}
                aria-label={t('common.dismiss')}
                className="shrink-0 rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
            >
                <X size={14} aria-hidden />
            </button>
        </div>
    );
}

/** The tab's own title at load, which the progress prefix is put in front of. */
const BASE_TITLE = document.title;

/** Shows generation progress in the browser tab's title, so a run can be watched from another tab
 *  (legacy main.js updateGenCount: "(N generating) SwarmUI"). This tab's own run reports its
 *  percentage; otherwise the status poll's count covers runs from elsewhere.
 *
 * A component of its own rather than a hook in the shell: it re-renders with every progress
 * message, and the shell must not. */
function ProgressTitle(): null {
    const { t } = useTranslation();
    const session = useSession();
    const status = useCurrentStatus(session.isSuccess);
    const local = useRunProgress();
    const stats = status.data?.status;
    const elsewhere = Math.max(stats?.waiting_gens ?? 0, stats?.live_gens ?? 0, stats?.loading_models ?? 0);
    const percent = local.percent === null ? null : Math.round(local.percent * 100);

    const title = percent !== null
        ? t('shell.title.progress', { percent, title: BASE_TITLE })
        : elsewhere > 0
          ? t('shell.title.generating', { count: elsewhere, title: BASE_TITLE })
          : BASE_TITLE;

    useEffect(() => {
        document.title = title;
    }, [title]);
    useEffect(() => () => {
        document.title = BASE_TITLE;
    }, []);
    return null;
}
