import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { setComfyFrame } from '@/comfy/bridge';
import { useTranslation } from '@/i18n';
import { isComfyCapable, type Backend } from '@/server/backends';

/** ComfyUI's own editor, embedded: an iframe pointed at `ComfyBackendDirect/`, which the server
 *  proxies to whichever Comfy backend is running. Needs a live Comfy backend, so this checks first
 *  and says so rather than showing a blank frame.
 *
 * The workflow tools live in the workspace header instead of here, so the editor gets the whole
 * pane; `reloadKey` is what they change to remount the frame. */
export function ComfyWorkflow(props: { reloadKey: number }) {
    const { t } = useTranslation();

    // The frame is registered globally rather than passed down, because the toolbar reaches into
    // Comfy's own `app` object and both live for as long as this workspace mode does.
    useEffect(() => () => setComfyFrame(null), []);

    const backends = useQuery({
        queryKey: ['backends'],
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', {}),
        refetchInterval: 10_000
    });

    const comfyBackends = Object.values(backends.data ?? {}).filter(isComfyCapable);
    const running = comfyBackends.some(b => b.status === 'running' || b.status === 'idle');

    if (backends.isPending) {
        return <Centered>{t('comfy.checking')}</Centered>;
    }

    if (!running) {
        return (
            <Centered>
                <p className="text-fg">{t('comfy.noBackend')}</p>
                <p className="mt-1 text-sm text-fg-soft">
                    {t('comfy.explain')}{' '}
                    {comfyBackends.length > 0
                        ? t('comfy.foundNotRunning', { count: comfyBackends.length })
                        : t('comfy.noneConfigured')}
                </p>
                <a
                    href="/ui/server/backends"
                    className="mt-3 inline-block rounded px-3 py-1.5 text-sm"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {t('comfy.goToBackends')}
                </a>
            </Centered>
        );
    }

    return (
        <iframe
            key={props.reloadKey}
            ref={setComfyFrame}
            src="/ComfyBackendDirect/"
            title={t('comfy.editorTitle')}
            className="h-full w-full border-0"
        />
    );
}

function Centered(props: { children: React.ReactNode }) {
    return (
        <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md text-center text-fg-soft">{props.children}</div>
        </div>
    );
}
