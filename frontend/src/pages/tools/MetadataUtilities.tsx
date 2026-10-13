import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { MetadataScanner } from '@/components/tools/MetadataScanner';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTranslation, trailingFragment } from '@/i18n';

/** Which database WipeMetadata clears. The route also takes `all`, which legacy no longer offers:
 *  the model reset is the one that has to wait for every backend to go idle, and wanting the image
 *  history re-read (after changing AllowAnimatedPreviews, say) should not cost that. */
type MetadataKind = 'image' | 'model';

export function MetadataUtilitiesPage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const canReset = usePermission('reset_metadata');
    const [confirming, setConfirming] = useState<MetadataKind | null>(null);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

    const wipe = useMutation({
        mutationFn: async (kind: MetadataKind) => {
            await api.post('WipeMetadata', { type: kind });
            // As legacy's util_massMetadataClear: the model lists are rescanned straight away,
            // while image metadata is re-read lazily as the history is browsed.
            if (kind === 'model') {
                await api.post('TriggerRefresh', {});
            }
        },
        onSuccess: (_result, kind) => {
            setResult({ ok: true, text: t(`metadataTool.resetDone.${kind}`) });
            if (kind === 'model') {
                queryClient.invalidateQueries({ queryKey: ['models'] });
                queryClient.invalidateQueries({ queryKey: queryKeys.t2iParams });
            }
            else {
                queryClient.invalidateQueries({ queryKey: ['images'] });
            }
        },
        onError: (e: unknown) =>
            setResult({ ok: false, text: e instanceof Error ? e.message : t('metadataTool.resetFailed') })
    });

    const button = (kind: MetadataKind) => (
        <button
            type="button"
            disabled={!canReset || wipe.isPending}
            onClick={() => setConfirming(kind)}
            className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
            style={{
                background: 'var(--danger-button-background)',
                color: 'var(--danger-button-foreground)'
            }}
        >
            {wipe.isPending && wipe.variables === kind
                ? t('metadataTool.resetting')
                : t(`metadataTool.reset.${kind}`)}
        </button>
    );

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
                <div className="flex flex-wrap justify-end gap-2">
                    {button('image')}
                    {button('model')}
                </div>
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

            <MetadataScanner />

            <ConfirmDialog
                open={confirming !== null}
                title={confirming ? t(`metadataTool.confirmTitle.${confirming}`) : ''}
                body={confirming ? t(`metadataTool.confirmBody.${confirming}`) : ''}
                confirmLabel={confirming ? t(`metadataTool.reset.${confirming}`) : ''}
                destructive
                onConfirm={() => {
                    if (confirming) {
                        setResult(null);
                        wipe.mutate(confirming);
                    }
                    setConfirming(null);
                }}
                onCancel={() => setConfirming(null)}
            />
        </ToolLayout>
    );
}
