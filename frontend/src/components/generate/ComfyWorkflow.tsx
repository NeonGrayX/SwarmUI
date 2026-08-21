import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import { useTranslation } from '@/i18n';

interface Backend {
    status: string;
    type: string;
}

/** ComfyUI's own editor, embedded.
 *
 * The legacy Comfy Workflow tab does the same thing - an iframe pointed at ComfyBackendDirect/
 * (comfy_workflow_editor_helper.js:110), which the server proxies to whichever Comfy backend is
 * running. It needs a live Comfy backend, so this checks first and explains itself when there
 * isn't one rather than showing a blank frame. */
export function ComfyWorkflow() {
    const { t } = useTranslation();
    const [reloadKey, setReloadKey] = useState(0);

    const backends = useQuery({
        queryKey: ['backends'],
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', {}),
        refetchInterval: 10_000
    });

    const comfyBackends = Object.values(backends.data ?? {}).filter(b =>
        b.type.toLowerCase().includes('comfy')
    );
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
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-1">
                <span className="text-xs text-fg-soft">{t('comfy.editorTitle')}</span>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={() => setReloadKey(k => k + 1)}
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <RefreshCw size={12} aria-hidden />
                    {t('common.reload')}
                </button>
                <a
                    href="/ComfyBackendDirect/"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    {t('common.openInNewTab')}
                    <ExternalLink size={11} aria-hidden />
                </a>
            </div>
            <iframe
                key={reloadKey}
                src="/ComfyBackendDirect/"
                title={t('comfy.editorTitle')}
                className="min-h-0 flex-1 border-0"
            />
        </div>
    );
}

function Centered(props: { children: React.ReactNode }) {
    return (
        <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md text-center text-fg-soft">{props.children}</div>
        </div>
    );
}
