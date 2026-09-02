import { useState } from 'react';
import { Download, ExternalLink, RefreshCw, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import {
    isComfyReady,
    loadApiPrompt,
    loadGraph,
    readMultiGpuMode,
    writeMultiGpuMode,
    type MultiGpuMode
} from '@/comfy/bridge';
import { useComfyBuilder } from '@/comfy/actions';
import { ComfyWorkflowError } from '@/comfy/params';
import { fetchSavedWorkflow, savedWorkflowGraph } from '@/comfy/saved';
import { useComfyWorkflowStore } from '@/comfy/store';
import { ComfyNoticeText, IconButton, SELECT_CLASS, useComfyNotice } from './ComfyBarParts';
import { ComfyLibraryControls } from './ComfyLibraryControls';
import { useGenInput } from '@/generate/input';
import { useTranslation } from '@/i18n';

/** Moving a workflow between the Comfy editor and the Generate panel, in both directions, plus the
 *  controls for the frame itself.
 *
 * It sits in the workspace header beside the mode switch rather than over the editor: Comfy owns
 * the whole frame and puts its own menus in the corners, so anything floating there covers a menu.
 * Sharing the one strip the workspace already has costs the editor no height of its own.
 *
 * Two groups, because the strip is read from both ends: what a workflow is for on the left, and
 * how the frame itself is driven - the backend it talks to, reloading it, opening it on its own -
 * pushed to the right, away from the workflow tools.
 */
export function ComfyWorkflowBar(props: { onUseInGenerate: () => void; onReloadFrame: () => void }) {
    const { t } = useTranslation();
    /** Name of the saved workflow last opened here, so the Generate panel can say which one it is
     *  showing. Editing the graph afterwards makes it a guess, but a useful one. */
    const [loadedName, setLoadedName] = useState<string | null>(null);
    const notice = useComfyNotice();

    const canUseDynamic = usePermission('comfy_dynamic_custom_workflows');

    const build = useComfyBuilder();
    const genInput = useGenInput();
    const activate = useComfyWorkflowStore(s => s.activate);

    /** Wraps an action so a Comfy that has not booted, or a graph it refuses, reports itself. */
    async function run(action: () => Promise<void>): Promise<void> {
        if (!isComfyReady()) {
            notice.show(t('comfy.error.notLoaded'), true);
            return;
        }
        try {
            await action();
        }
        catch (e) {
            if (e instanceof ComfyWorkflowError) {
                notice.show(t('comfy.error.noSaveNode'), true);
                return;
            }
            notice.show(e instanceof Error ? e.message : String(e), true);
        }
    }

    const useInGenerate = () =>
        run(async () => {
            const { input, workflow } = await build(true);
            activate(input, loadedName, workflow);
            props.onUseInGenerate();
        });

    const importFromGenerate = () =>
        run(async () => {
            notice.show(t('comfy.notice.loading'));
            const data = await api.post<{ workflow?: string }>('ComfyGetGeneratedWorkflow', genInput());
            if (!data.workflow) {
                notice.show(t('comfy.error.noWorkflow'), true);
                return;
            }
            loadApiPrompt(JSON.parse(data.workflow));
            setLoadedName(null);
            notice.show(t('comfy.notice.imported'));
        });

    const loadByName = (name: string) =>
        void run(async () => {
            notice.show(t('comfy.notice.loading'));
            loadGraph(savedWorkflowGraph(await fetchSavedWorkflow(name)));
            setLoadedName(name);
            notice.show(t('comfy.notice.loaded'));
        });

    return (
        <>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    onClick={useInGenerate}
                    disabled={!canUseDynamic}
                    title={canUseDynamic ? t('comfy.bar.useHint') : undefined}
                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    <Download size={12} aria-hidden />
                    {t('comfy.bar.use')}
                </button>

                <IconButton onClick={importFromGenerate} label={t('comfy.bar.import')}>
                    <Upload size={13} aria-hidden />
                </IconButton>
                <ComfyLibraryControls notice={notice} build={build} onLoad={loadByName} />

                <ComfyNoticeText notice={notice} />
            </div>

            <div className="ml-auto flex items-center gap-1.5">
                <MultiGpuSelect onChange={props.onReloadFrame} />
                <span className="mx-0.5 h-4 w-px shrink-0 bg-default" aria-hidden />
                <IconButton onClick={props.onReloadFrame} label={t('common.reload')}>
                    <RefreshCw size={13} aria-hidden />
                </IconButton>
                <a
                    href="/ComfyBackendDirect/"
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={t('common.openInNewTab')}
                    title={t('common.openInNewTab')}
                    className="flex h-6 w-6 items-center justify-center rounded text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                >
                    <ExternalLink size={13} aria-hidden />
                </a>
            </div>
        </>
    );
}

const MULTI_GPU_MODES: { id: MultiGpuMode; labelKey: string }[] = [
    { id: 'none', labelKey: 'comfy.multiGpu.none' },
    { id: 'all', labelKey: 'comfy.multiGpu.all' },
    { id: 'queue', labelKey: 'comfy.multiGpu.queue' },
    { id: 'reserve', labelKey: 'comfy.multiGpu.reserve' }
];

/** Which backend the embedded editor talks to. The proxy reads this off a cookie on connect, so
 *  changing it only takes effect once the frame reloads. */
function MultiGpuSelect(props: { onChange: () => void }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<MultiGpuMode>(() => readMultiGpuMode());
    return (
        <select
            className={SELECT_CLASS}
            value={mode}
            aria-label={t('comfy.bar.multiGpu')}
            onChange={e => {
                const next = e.target.value as MultiGpuMode;
                setMode(next);
                writeMultiGpuMode(next);
                props.onChange();
            }}
        >
            {MULTI_GPU_MODES.map(option => (
                <option key={option.id} value={option.id}>
                    {t(option.labelKey)}
                </option>
            ))}
        </select>
    );
}
