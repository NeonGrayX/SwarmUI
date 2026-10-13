import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import * as Popover from '@radix-ui/react-popover';
import { LogOut, UserRound, VenetianMask } from 'lucide-react';
import { api } from '@/api/client';
import { useSession } from '@/api/hooks';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTranslation } from '@/i18n';

/** The id the server gives everyone when accounts are off (SessionHandler.LocalUserID). There is
 *  no login behind it, so nothing to log out of. */
const LOCAL_USER_ID = 'local';

/** Who is signed in, with the way to their account settings and out of the account. */
export function AccountMenu(props: { compact?: boolean }) {
    const { t } = useTranslation();
    const session = useSession();
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const userId = session.data?.user_id;
    if (!userId) {
        return null;
    }
    const impersonating = api.impersonating;
    const canLogOut = userId !== LOCAL_USER_ID || impersonating !== null;

    const logOut = async () => {
        setError(null);
        try {
            await api.logout();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <>
            <Popover.Root>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={t('shell.account.menu')}
                        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                    >
                        {impersonating ? <VenetianMask size={15} aria-hidden /> : <UserRound size={15} aria-hidden />}
                        {!props.compact && <span className="max-w-32 truncate">{userId}</span>}
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        side="bottom"
                        align="end"
                        sideOffset={6}
                        className="z-50 min-w-48 rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                    >
                        <div className="px-2 py-1.5 text-xs text-fg-soft">
                            {t('shell.account.signedInAs')}{' '}
                            <span className="font-medium text-fg-strong">{userId}</span>
                        </div>
                        <Popover.Close asChild>
                            <Link
                                to="/settings/account"
                                className="block w-full rounded px-2 py-1.5 text-left text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('shell.account.settings')}
                            </Link>
                        </Popover.Close>
                        {impersonating && (
                            <Popover.Close asChild>
                                <button
                                    type="button"
                                    onClick={() => api.stopImpersonating()}
                                    className="block w-full rounded px-2 py-1.5 text-left text-sm text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    {t('shell.impersonating.stop')}
                                </button>
                            </Popover.Close>
                        )}
                        {canLogOut && (
                            <Popover.Close asChild>
                                <button
                                    type="button"
                                    onClick={() => setConfirming(true)}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    <LogOut size={14} aria-hidden />
                                    {t('shell.account.logOut')}
                                </button>
                            </Popover.Close>
                        )}
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
            <ConfirmDialog
                open={confirming}
                title={t('shell.account.logOutTitle')}
                body={
                    <>
                        {t('shell.account.logOutBody')}
                        {error && (
                            <span className="mt-2 block" style={{ color: 'var(--backend-errored)' }}>
                                {error}
                            </span>
                        )}
                    </>
                }
                confirmLabel={t('shell.account.logOut')}
                destructive
                onConfirm={() => void logOut()}
                onCancel={() => {
                    setConfirming(false);
                    setError(null);
                }}
            />
        </>
    );
}

/** A standing reminder that this admin is acting as someone else, and the way back
 *  (UserTab.cshtml `impersonate_user_container`). */
export function ImpersonationBanner() {
    const { t } = useTranslation();
    const session = useSession();
    const impersonating = session.data ? api.impersonating : null;
    if (!impersonating) {
        return null;
    }
    return (
        <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm text-fg"
            style={{
                background: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 18%, transparent)',
                borderColor: 'color-mix(in srgb, var(--status-bar-warn-color-middle) 40%, transparent)'
            }}
        >
            <VenetianMask size={15} className="shrink-0" aria-hidden />
            <span className="flex-1">{t('shell.impersonating.notice', { user: impersonating })}</span>
            <button
                type="button"
                onClick={() => api.stopImpersonating()}
                className="rounded border border-default px-2 py-0.5 text-xs hover:bg-[var(--sw-hover)]"
            >
                {t('shell.impersonating.stop')}
            </button>
        </div>
    );
}
