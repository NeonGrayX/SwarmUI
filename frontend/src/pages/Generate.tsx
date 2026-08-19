import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { ParamForm } from '@/components/form/ParamForm';
import { PromptComposer } from '@/components/generate/PromptComposer';
import { Canvas } from '@/components/generate/Canvas';
import { BatchRail } from '@/components/generate/BatchRail';
import { ContextStrip } from '@/components/generate/ContextStrip';
import { Splitter } from '@/components/generate/Splitter';
import { ComfyWorkflow } from '@/components/generate/ComfyWorkflow';
import { PRESETS, useLayoutStore, type LayoutPreset } from '@/generate/layout';
import { useGenerateStore } from '@/generate/store';
import { useStartGenerate } from '@/generate/start';

/** The Generate workspace: parameters, canvas, batch rail, and the prompt composer beneath. */
/** Comfy Workflow was a sibling top-level tab in the legacy UI; here it is a mode of the Generate
 *  workspace, since it is another way to drive the same generation, not a separate destination. */
type WorkspaceMode = 'standard' | 'comfy';

export function GeneratePage() {
    const [mode, setMode] = useState<WorkspaceMode>('standard');
    const paramsWidth = useLayoutStore(s => s.params);
    const batchWidth = useLayoutStore(s => s.batch);
    const resize = useLayoutStore(s => s.resize);

    const forever = useGenerateStore(s => s.forever);
    const running = useGenerateStore(s => s.running);
    const startGenerate = useStartGenerate();

    // "Generate forever" re-fires as soon as the previous run finishes. A refused run clears
    // `forever` (useGenerateStore.fail), so a bad request stops the loop rather than spinning it.
    useEffect(() => {
        if (forever && !running) {
            const timer = setTimeout(startGenerate, 100);
            return () => clearTimeout(timer);
        }
    }, [forever, running, startGenerate]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1">
                <aside
                    className="shrink-0 overflow-hidden border-r border-subtle bg-surface"
                    style={{ width: paramsWidth }}
                >
                    <ParamForm />
                </aside>
                <Splitter label="Resize parameter panel" onResize={d => resize('params', d)} />

                <div className="flex min-w-0 flex-1 flex-col">
                    <WorkspaceHeader mode={mode} onMode={setMode} />
                    {mode === 'comfy' ? <ComfyWorkflow /> : <Canvas />}
                </div>

                <Splitter label="Resize batch panel" invert onResize={d => resize('batch', d)} />
                <aside
                    className="shrink-0 overflow-hidden border-l border-subtle bg-surface"
                    style={{ width: batchWidth }}
                >
                    <BatchRail />
                </aside>
            </div>

            <ContextStrip />
            <PromptComposer />
        </div>
    );
}

function WorkspaceHeader(props: { mode: WorkspaceMode; onMode: (mode: WorkspaceMode) => void }) {
    const preset = useLayoutStore(s => s.preset);
    const applyPreset = useLayoutStore(s => s.applyPreset);

    return (
        <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-1">
            <div className="flex overflow-hidden rounded border border-default">
                {([['standard', 'Standard'], ['comfy', 'Comfy Workflow']] as const).map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => props.onMode(id)}
                        aria-pressed={props.mode === id}
                        className="px-2.5 py-0.5 text-xs transition-colors"
                        style={
                            props.mode === id
                                ? { background: 'var(--sw-active)', color: 'var(--text-strong)' }
                                : { color: 'var(--sw-fg-soft)' }
                        }
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="flex-1" />
            <Popover.Root>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        <LayoutGrid size={13} aria-hidden />
                        Layout
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        side="bottom"
                        align="end"
                        sideOffset={6}
                        className="z-50 min-w-44 rounded-lg border border-default bg-surface-raised p-1 shadow-xl"
                    >
                        {(Object.keys(PRESETS) as LayoutPreset[]).map(id => (
                            <Popover.Close asChild key={id}>
                                <button
                                    type="button"
                                    onClick={() => applyPreset(id)}
                                    className={[
                                        'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--sw-hover)]',
                                        preset === id ? 'text-fg-strong' : 'text-fg'
                                    ].join(' ')}
                                >
                                    {PRESETS[id].label}
                                    {preset === id && <span className="ml-2 text-xs text-fg-soft">current</span>}
                                </button>
                            </Popover.Close>
                        ))}
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    );
}
