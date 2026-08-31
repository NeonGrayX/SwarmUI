import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useSession } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { MIN_PASSWORD_LENGTH, prehashPassword } from '@/api/password';
import { useMyUserData } from '@/library/hooks';
import { Field } from '@/components/form/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { findLanguage, t as translate, useTranslation } from '@/i18n';

interface AuthToken {
    id: string;
    created: number;
    last_active: number;
    user_agent: string;
    origin_address: string;
    is_current: boolean;
}

/** The auth-token routes all refuse when the server has no user authorization configured.
 *  Matched against the server's English message, which is what the API actually returns. */
const AUTH_DISABLED = 'Authorization is not enabled.';

interface UpstreamKey {
    /** Storage id the server knows the key by, eg 'huggingface_api'. */
    keyType: string;
    /** Brand name, deliberately not translated. */
    title: string;
    /** Where the user goes to mint one. */
    createLink: string;
    infoKey: string;
}

/** Keys the server accepts for the logged-in user. Mirrors
 *  BasicAPIFeatures.AcceptedAPIKeyTypes — SetAPIKey rejects anything outside that fixed set, so
 *  there is nothing gained by asking the server for the list. */
const UPSTREAM_KEYS: UpstreamKey[] = [
    {
        keyType: 'stability_api',
        title: 'Stability AI',
        createLink: 'https://platform.stability.ai/account/keys',
        infoKey: 'apiKeys.info.stability'
    },
    {
        keyType: 'civitai_api',
        title: 'Civitai',
        createLink: 'https://civitai.com/user/account',
        infoKey: 'apiKeys.info.civitai'
    },
    {
        keyType: 'huggingface_api',
        title: 'Hugging Face',
        createLink: 'https://huggingface.co/settings/tokens',
        infoKey: 'apiKeys.info.huggingface'
    }
];

/** GetAPIKeyStatus answers with a sentence, not a field: 'not set', or 'last updated <stamp>'
 *  (BasicAPIFeatures.GetAPIKeyStatus). Split the stamp back out so the label can be translated. */
const KEY_SET_PREFIX = 'last updated ';

function unixToText(seconds: number): string {
    return seconds ? new Date(seconds * 1000).toLocaleString() : translate('account.never');
}

const INPUT =
    'w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]';

export function AccountPage() {
    const { t } = useTranslation();
    const session = useSession();
    const userData = useMyUserData();
    // The profile stores a code; show the language's own name, as the picker does.
    const language = findLanguage(userData.data?.language);

    return (
        <div className="h-full overflow-y-auto p-4">
            <div className="grid max-w-3xl gap-3" style={{ ['--sw-field-label-width' as string]: '10rem' }}>
                <Panel title={t('account.profile')}>
                    <Field id="user" label={t('account.userId')} density="compact">
                        <span className="text-sm text-fg">{session.data?.user_id ?? '—'}</span>
                    </Field>
                    <Field id="perms" label={t('users.tab.permissions')} density="compact">
                        <span className="text-sm text-fg">
                            {t('account.permissionsGranted', {
                                count: session.data?.permissions.length ?? 0
                            })}
                        </span>
                    </Field>
                    <Field id="lang" label={t('appearance.language.title')} density="compact">
                        <span className="text-sm text-fg">
                            {language?.localName ?? userData.data?.language ?? '—'}
                        </span>
                    </Field>
                </Panel>

                <ChangePasswordPanel />
                <ApiKeysPanel />
                <AuthTokensPanel />
            </div>
        </div>
    );
}

function ChangePasswordPanel() {
    const { t } = useTranslation();
    const session = useSession();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const userId = session.data?.user_id ?? '';

    const change = useMutation({
        // Both values go over prehashed. The server hashes again on top of whatever it receives
        // (BasicAPIFeatures.ChangePassword), so a raw password here would store a hash the login
        // page — which does prehash — could never reproduce, locking the account out.
        mutationFn: async () =>
            api.post('ChangePassword', {
                oldPassword: await prehashPassword(userId, current),
                newPassword: await prehashPassword(userId, next)
            }),
        onSuccess: () => {
            setMessage({ ok: true, text: t('account.passwordChanged') });
            setCurrent('');
            setNext('');
            setConfirm('');
        },
        onError: (e: unknown) =>
            setMessage({ ok: false, text: e instanceof Error ? e.message : t('account.passwordChangeFailed') })
    });

    const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
    const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
    const canSubmit =
        Boolean(userId) && current && next.length >= MIN_PASSWORD_LENGTH && next === confirm && !change.isPending;

    return (
        <Panel title={t('account.changePassword')}>
            <Field id="current-pw" label={t('account.currentPassword')} density="compact">
                <input
                    id="current-pw"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={e => setCurrent(e.target.value)}
                    className={INPUT}
                />
            </Field>
            <Field id="new-pw" label={t('account.newPassword')} density="compact">
                <input
                    id="new-pw"
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={e => setNext(e.target.value)}
                    className={INPUT}
                />
            </Field>
            <Field id="confirm-pw" label={t('account.confirmNewPassword')} density="compact">
                <input
                    id="confirm-pw"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className={INPUT}
                />
            </Field>
            {mismatch && (
                <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {t('account.newPasswordMismatch')}
                </p>
            )}
            {tooShort && (
                <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {t('account.passwordTooShort', { count: MIN_PASSWORD_LENGTH })}
                </p>
            )}
            {message && (
                <p
                    className="mt-1 text-xs"
                    style={{ color: message.ok ? 'var(--backend-running)' : 'var(--backend-errored)' }}
                >
                    {message.text}
                </p>
            )}
            <div className="mt-2 flex justify-end">
                <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={() => change.mutate()}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {change.isPending ? t('account.changing') : t('account.changePassword')}
                </button>
            </div>
        </Panel>
    );
}

function AuthTokensPanel() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
    const [newToken, setNewToken] = useState<string | null>(null);
    const [reason, setReason] = useState('');

    const tokens = useQuery({
        queryKey: ['auth-tokens'],
        queryFn: () => api.post<{ tokens: AuthToken[] }>('ListMyAuthTokens')
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['auth-tokens'] });

    const create = useMutation({
        // `reason` is required and is stored as the token's user-agent label.
        mutationFn: () => api.post<{ token: string }>('CreateAuthToken', { reason: reason.trim() }),
        onSuccess: data => {
            setNewToken(data.token);
            setReason('');
            invalidate();
        }
    });
    const revoke = useMutation({
        mutationFn: (id: string) => api.post('RevokeMyAuthToken', { tokenId: id }),
        onSuccess: invalidate
    });

    const list = tokens.data?.tokens ?? [];
    const authDisabled =
        tokens.isError && tokens.error instanceof Error && tokens.error.message.includes(AUTH_DISABLED);

    // Nothing here works without user authorization, so say so plainly instead of showing an error.
    if (authDisabled) {
        return (
            <Panel title={t('account.authTokens')}>
                <p className="text-sm text-fg-soft">{t('account.authDisabled')}</p>
            </Panel>
        );
    }

    return (
        <Panel title={t('account.authTokens')}>
            <p className="mb-2 text-xs text-fg-soft">{t('account.authTokensNote')}</p>

            {newToken && (
                <div className="mb-2 rounded border border-default bg-surface-sunken p-2">
                    <p className="mb-1 text-xs text-fg-soft">{t('account.newToken')}</p>
                    <code className="block break-all font-mono text-xs text-fg">{newToken}</code>
                </div>
            )}

            {tokens.isPending ? (
                <p className="text-sm text-fg-soft">{t('common.loading')}</p>
            ) : list.length === 0 ? (
                <p className="text-sm text-fg-soft">{t('account.noTokens')}</p>
            ) : (
                <ul className="divide-y divide-[var(--light-border)]">
                    {list.map(token => (
                        <li key={token.id} className="flex items-center gap-3 py-1.5">
                            <KeyRound size={14} className="shrink-0 text-fg-soft" aria-hidden />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{token.id}</span>
                            {token.is_current && (
                                <span className="shrink-0 text-xs" style={{ color: 'var(--backend-running)' }}>
                                    {t('account.thisSession')}
                                </span>
                            )}
                            <span className="shrink-0 text-xs text-fg-soft" title={token.user_agent}>
                                {t('account.lastActive', { when: unixToText(token.last_active) })}
                            </span>
                            <button
                                type="button"
                                onClick={() => setPendingRevoke(token.id)}
                                aria-label={t('account.revokeToken')}
                                title={t('account.revokeToken')}
                                className="shrink-0 rounded p-1 hover:bg-[var(--sw-hover)]"
                                style={{ color: 'var(--backend-errored)' }}
                            >
                                <Trash2 size={13} aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-3 flex items-end gap-2">
                <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs text-fg-soft">{t('account.tokenReason')}</span>
                    <input
                        type="text"
                        value={reason}
                        maxLength={500}
                        onChange={e => setReason(e.target.value)}
                        placeholder={t('account.tokenReasonPlaceholder')}
                        className={INPUT}
                    />
                </label>
                <button
                    type="button"
                    onClick={() => create.mutate()}
                    disabled={create.isPending || !reason.trim()}
                    className="shrink-0 rounded border border-default px-3 py-1.5 text-sm text-fg disabled:opacity-40 hover:bg-[var(--sw-hover)]"
                >
                    {create.isPending ? t('common.creating') : t('account.createToken')}
                </button>
            </div>

            <ConfirmDialog
                open={pendingRevoke !== null}
                title={t('account.revokeTitle')}
                body={t('account.revokeBody')}
                confirmLabel={t('account.revoke')}
                destructive
                onConfirm={() => {
                    if (pendingRevoke) {
                        revoke.mutate(pendingRevoke);
                    }
                    setPendingRevoke(null);
                }}
                onCancel={() => setPendingRevoke(null)}
            />
        </Panel>
    );
}

function ApiKeysPanel() {
    const { t } = useTranslation();
    const canRead = usePermission('read_user_settings');
    const canEdit = usePermission('edit_user_settings');

    if (!canRead && !canEdit) {
        return null;
    }

    return (
        <Panel title={t('apiKeys.title')}>
            <p className="mb-2 text-xs text-fg-soft">{t('apiKeys.note')}</p>
            {!canEdit && <p className="mb-2 text-xs text-fg-soft">{t('apiKeys.readOnly')}</p>}
            <ul className="divide-y divide-[var(--light-border)]">
                {UPSTREAM_KEYS.map(info => (
                    <ApiKeyRow key={info.keyType} info={info} canRead={canRead} canEdit={canEdit} />
                ))}
            </ul>
        </Panel>
    );
}

function ApiKeyRow(props: { info: UpstreamKey; canRead: boolean; canEdit: boolean }) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { info } = props;
    const [value, setValue] = useState('');
    const statusKey = ['api-key-status', info.keyType];

    const status = useQuery({
        queryKey: statusKey,
        queryFn: () => api.post<{ status: string }>('GetAPIKeyStatus', { keyType: info.keyType }),
        enabled: props.canRead
    });

    const save = useMutation({
        // 'none' is the server's unset sentinel, not a key value.
        mutationFn: (key: string) => api.post('SetAPIKey', { keyType: info.keyType, key }),
        onSuccess: () => {
            setValue('');
            queryClient.invalidateQueries({ queryKey: statusKey });
        }
    });

    const raw = status.data?.status;
    const savedAt = raw?.startsWith(KEY_SET_PREFIX) ? raw.slice(KEY_SET_PREFIX.length) : null;
    const isSet = savedAt !== null;

    return (
        <li className="py-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg-strong">{info.title}</span>
                <span className="text-xs text-fg-soft">
                    {!props.canRead
                        ? '—'
                        : status.isPending
                          ? t('common.loading')
                          : isSet
                            ? t('apiKeys.savedAt', { when: savedAt })
                            : t('apiKeys.notSet')}
                </span>
                <a
                    href={info.createLink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto inline-flex items-center gap-1 text-xs underline"
                    style={{ color: 'var(--emphasis)' }}
                >
                    {t('apiKeys.getKey')}
                    <ExternalLink size={11} aria-hidden />
                </a>
            </div>
            <p className="mt-0.5 text-xs text-fg-soft">{t(info.infoKey)}</p>
            <div className="mt-1.5 flex items-center gap-2">
                <input
                    type="password"
                    value={value}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!props.canEdit || save.isPending}
                    placeholder={t('apiKeys.placeholder', { service: info.title })}
                    onChange={e => setValue(e.target.value)}
                    aria-label={t('apiKeys.placeholder', { service: info.title })}
                    className={`${INPUT} min-w-0 flex-1 disabled:opacity-40`}
                />
                <button
                    type="button"
                    disabled={!props.canEdit || !value.trim() || save.isPending}
                    onClick={() => save.mutate(value.trim())}
                    className="shrink-0 rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {save.isPending ? t('common.saving') : t('common.save')}
                </button>
                <button
                    type="button"
                    disabled={!props.canEdit || !isSet || save.isPending}
                    onClick={() => save.mutate('none')}
                    className="shrink-0 rounded border border-default px-3 py-1.5 text-sm text-fg disabled:opacity-40 hover:bg-[var(--sw-hover)]"
                >
                    {t('common.remove')}
                </button>
            </div>
            {save.isError && (
                <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                    {save.error instanceof Error ? save.error.message : t('apiKeys.saveFailed')}
                </p>
            )}
        </li>
    );
}

function Panel(props: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-default bg-surface p-4">
            <h2 className="mb-2 text-sm font-medium text-fg-strong">{props.title}</h2>
            {props.children}
        </section>
    );
}
