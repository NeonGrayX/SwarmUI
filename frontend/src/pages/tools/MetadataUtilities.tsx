import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTranslation, trailingFragment } from '@/i18n';

export function MetadataUtilitiesPage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const canReset = usePermission('reset_metadata');
    const [confirming, setConfirming] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

    const wipe = useMutation({
        mutationFn: () => api.post('WipeMetadata', {}),
        onSuccess: () => {
            setResult({ ok: true, text: t('metadataTool.resetDone') });
            queryClient.invalidateQueries({ queryKey: ['models'] });
        },
        onError: (e: unknown) =>
            setResult({ ok: false, text: e instanceof Error ? e.message : t('metadataTool.resetFailed') })
    });

    return (
        <ToolLayout
            title={t('nav.destination.metadata')}
            summary={t('metadataTool.summary')}
            about={
                <>
                    <p>{t('metadataTool.about1')}</p>
                    <p>{t('metadataTool.about2')}</p>
                    <p>
                        {t('metadataTool.about3Before')}{' '}
                        <a href="/Text2Image" className="underline" style={{ color: 'var(--emphasis)' }}>
                            /Text2Image
                        </a>
                        {trailingFragment(t('metadataTool.about3After'))}
                    </p>
                </>
            }
            warning={t('metadataTool.warning')}
            action={
                <button
                    type="button"
                    disabled={!canReset || wipe.isPending}
                    onClick={() => setConfirming(true)}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{
                        background: 'var(--danger-button-background)',
                        color: 'var(--danger-button-foreground)'
                    }}
                >
                    {wipe.isPending ? t('metadataTool.resetting') : t('metadataTool.resetAll')}
                </button>
            }
        >
            <p className="text-sm text-fg-soft">{t('metadataTool.body')}</p>

            {!canReset && (
                <p className="mt-2 text-sm" style={{ color: 'var(--status-bar-warn-color-start-end)' }}>
                    {t('metadataTool.noPermissionBefore')}{' '}
                    <code className="font-mono">reset_metadata</code>
                    {trailingFragment(t('metadataTool.noPermissionAfter'))}
                </p>
            )}

            {result && (
                <p
                    className="mt-2 border-t border-subtle pt-2 text-sm"
                    style={{ color: result.ok ? 'var(--backend-running)' : 'var(--backend-errored)' }}
                >
                    {result.text}
                </p>
            )}

            <ConfirmDialog
                open={confirming}
                title={t('metadataTool.confirmTitle')}
                body={t('metadataTool.confirmBody')}
                confirmLabel={t('metadataTool.resetMetadata')}
                destructive
                onConfirm={() => {
                    setConfirming(false);
                    setResult(null);
                    wipe.mutate();
                }}
                onCancel={() => setConfirming(false)}
            />
        </ToolLayout>
    );
}
