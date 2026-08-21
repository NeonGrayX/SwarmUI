import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useSession, useT2IParams } from '@/api/hooks';
import { Field } from '@/components/form/Field';
import { ToolLayout } from '@/components/tools/ToolLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTranslation } from '@/i18n';

export function PickleToSafetensorsPage() {
    const { t } = useTranslation();
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const [type, setType] = useState('Stable-Diffusion');
    const [fp16, setFp16] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const convert = useMutation({
        mutationFn: () => api.post<{ success?: boolean }>('Pickle2SafeTensor', { type, fp16 }),
        onSuccess: () => setResult(t('pickle2st.finished')),
        onError: (e: unknown) => setResult(e instanceof Error ? e.message : t('pickle2st.failed'))
    });

    const modelTypes = Object.keys(params.data?.models ?? {});

    return (
        <ToolLayout
            title={t('nav.destination.pickle2safetensors')}
            summary={t('pickle2st.summary')}
            about={
                <>
                    <p>{t('pickle2st.about1')}</p>
                    <p>{t('pickle2st.about2')}</p>
                </>
            }
            warning={t('pickle2st.warning')}
            action={
                <button
                    type="button"
                    disabled={convert.isPending}
                    onClick={() => setConfirming(true)}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {convert.isPending ? t('pickle2st.converting') : t('pickle2st.convertModels')}
                </button>
            }
        >
            <Field id="p2s-type" label={t('pickle2st.modelType')} density="compact">
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
                label={t('pickle2st.convertToFp16')}
                description={t('pickle2st.convertToFp16Help')}
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
                title={t('pickle2st.confirmTitle')}
                body={
                    <>
                        {t('pickle2st.confirmBefore')}{' '}
                        <strong className="text-fg">{type}</strong>{' '}
                        {fp16 ? t('pickle2st.confirmAfterFp16') : t('pickle2st.confirmAfter')}
                    </>
                }
                confirmLabel={t('pickle2st.convert')}
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
