import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useSession, useT2IParams } from '@/api/hooks';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export function PickleToSafetensorsPage() {
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const [type, setType] = useState('Stable-Diffusion');
    const [fp16, setFp16] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const convert = useMutation({
        mutationFn: () => api.post<{ success?: boolean }>('Pickle2SafeTensor', { type, fp16 }),
        onSuccess: () => setResult('Conversion finished. Check the server logs for per-file detail.'),
        onError: (e: unknown) => setResult(e instanceof Error ? e.message : 'Conversion failed.')
    });

    const modelTypes = Object.keys(params.data?.models ?? {});

    return (
        <ToolLayout
            title="Pickle To Safetensors"
            summary="Convert legacy .ckpt pickle models in a folder to the safer .safetensors format."
            about={
                <>
                    <p>
                        Pickle files can execute arbitrary code when loaded. Safetensors is a plain
                        data format that cannot, so converting is a security improvement as well as
                        a speed one.
                    </p>
                    <p>
                        This scans every configured folder for the selected model type and converts
                        all pickle files it finds. It can take a long while for large collections.
                    </p>
                </>
            }
            warning={
                <>
                    This converts <strong>every</strong> pickle model of the selected type, not a
                    single file. Converting to fp16 halves file size but discards precision.
                </>
            }
            action={
                <button
                    type="button"
                    disabled={convert.isPending}
                    onClick={() => setConfirming(true)}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    style={{ background: 'var(--emphasis)', color: 'var(--emphasis-text)' }}
                >
                    {convert.isPending ? 'Converting…' : 'Convert models'}
                </button>
            }
        >
            <Field id="p2s-type" label="Model type" density="compact">
                <select
                    id="p2s-type"
                    value={type}
                    onChange={e => setType(e.target.value)}
                    className="w-full rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                >
                    {(modelTypes.length > 0 ? modelTypes : ['Stable-Diffusion']).map(option => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            </Field>

            <Field
                id="p2s-fp16"
                label="Convert to fp16"
                description="Halves file size. Leave off to keep the original weight precision."
                density="compact"
            >
                <input
                    id="p2s-fp16"
                    type="checkbox"
                    checked={fp16}
                    onChange={e => setFp16(e.target.checked)}
                    className="accent-[var(--emphasis)]"
                />
            </Field>

            {result && (
                <p className="mt-2 border-t border-subtle pt-2 text-sm text-fg-soft">{result}</p>
            )}

            <ConfirmDialog
                open={confirming}
                title="Convert all pickle models?"
                body={
                    <>
                        Every pickle model of type <strong className="text-fg">{type}</strong> will be
                        converted{fp16 ? ' to fp16 safetensors' : ' to safetensors'}. This rewrites
                        files on disk and may take a long time.
                    </>
                }
                confirmLabel="Convert"
                onConfirm={() => {
                    setConfirming(false);
                    setResult(null);
                    convert.mutate();
                }}
                onCancel={() => setConfirming(false)}
            />
        </ToolLayout>
    );
}
