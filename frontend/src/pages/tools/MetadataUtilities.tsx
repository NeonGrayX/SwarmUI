import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export function MetadataUtilitiesPage() {
    const queryClient = useQueryClient();
    const canReset = usePermission('reset_metadata');
    const [confirming, setConfirming] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

    const wipe = useMutation({
        mutationFn: () => api.post('WipeMetadata', {}),
        onSuccess: () => {
            setResult({ ok: true, text: 'Metadata databases reset. They will rebuild from source files.' });
            queryClient.invalidateQueries({ queryKey: ['models'] });
        },
        onError: (e: unknown) =>
            setResult({ ok: false, text: e instanceof Error ? e.message : 'Failed to reset metadata.' })
    });

    return (
        <ToolLayout
            title="Metadata Utilities"
            summary="Rebuild Swarm's model and image metadata databases."
            about={
                <>
                    <p>
                        Swarm keeps a database of model and image metadata so it doesn't have to
                        re-read every file constantly. Resetting clears that database; it rebuilds
                        from the source files on next use.
                    </p>
                    <p>
                        This is useful if you've edited model or image files outside of Swarm and
                        want its tracking to catch up. It does not modify the files themselves —
                        only Swarm's index of them.
                    </p>
                    <p>
                        Civitai metadata scanning, which the legacy interface offers here, is not
                        yet ported. Use{' '}
                        <a href="/Text2Image" className="underline" style={{ color: 'var(--emphasis)' }}>
                            /Text2Image
                        </a>{' '}
                        for that.
                    </p>
                </>
            }
            warning={
                <>
                    If you have <strong>manually edited</strong> model metadata inside Swarm, resetting
                    discards those edits — they live in the database, not the model files. There is no
                    undo.
                </>
            }
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
                    {wipe.isPending ? 'Resetting…' : 'Reset all metadata'}
                </button>
            }
        >
            <p className="text-sm text-fg-soft">
                Clears the model and image metadata datastores. Everything is re-read from the
                original files afterwards, so the first browse after a reset is slower than usual.
            </p>

            {!canReset && (
                <p className="mt-2 text-sm" style={{ color: 'var(--status-bar-warn-color-start-end)' }}>
                    Your account doesn't have the <code className="font-mono">reset_metadata</code>{' '}
                    permission.
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
                title="Reset all metadata?"
                body={
                    <>
                        Swarm's model and image metadata databases will be cleared and rebuilt from
                        source files. Any metadata you edited inside Swarm will be lost. This cannot
                        be undone.
                    </>
                }
                confirmLabel="Reset metadata"
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
