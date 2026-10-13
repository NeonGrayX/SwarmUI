import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/hooks';
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
        queryKey: queryKeys.backends(false),
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', { full_data: false }),
        refetchInterval: 10_000
    });

    const comfyBackends = Object.values(backends.data ?? {}).filter(isComfyCapable);
    const running = comfyBackends.some(b => b.status === 'running' || b.status === 'idle');

    // Once the editor has been up, it stays up: a backend restarting (or one poll catching it
    // mid-load) must not throw away the graph someone is working on. The outage is reported over
    // the frame instead, and the frame picks back up when the backend does.
    const [mounted, setMounted] = useState(false);
    if (running && !mounted) {
        setMounted(true);
    }

    if (!mounted && backends.isPending) {
        return <Centered>{t('comfy.checking')}</Centered>;
    }

    if (!mounted) {
        return (
            <Centered>
                <NoBackend count={comfyBackends.length} />
            </Centered>
        );
    }

    return (
        <div className="relative h-full w-full">
            <iframe
                key={props.reloadKey}
                ref={setComfyFrame}
                src="/ComfyBackendDirect/"
                title={t('comfy.editorTitle')}
                className="h-full w-full border-0"
            />
            {!running && backends.isSuccess && (
                <div
                    role="status"
                    className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm text-fg"
                    style={{
                        background: 'var(--sw-error-tint)',
                        borderColor: 'var(--sw-error-border)'
                    }}
                >
                    <span className="flex-1">{t('comfy.backendLost')}</span>
                    <a href="/ui/server/backends" className="underline">
                        {t('comfy.goToBackends')}
                    </a>
                </div>
            )}
        </div>
    );
}

/** Why the editor cannot open, and where to go about it. */
function NoBackend(props: { count: number }) {
    const { t } = useTranslation();
    return (
        <>
            <p className="text-fg">{t('comfy.noBackend')}</p>
            <p className="mt-1 text-sm text-fg-soft">
                {t('comfy.explain')}{' '}
                {props.count > 0 ? t('comfy.foundNotRunning', { count: props.count }) : t('comfy.noneConfigured')}
            </p>
            <a
                href="/ui/server/backends"
                className="mt-3 inline-block rounded px-3 py-1.5 text-sm"
                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
            >
                {t('comfy.goToBackends')}
            </a>
        </>
    );
}

function Centered(props: { children: React.ReactNode }) {
    return (
        <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md text-center text-fg-soft">{props.children}</div>
        </div>
    );
}
