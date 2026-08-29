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
import { ImageEditor } from '@/components/editor/ImageEditor';
import { useEditorStore } from '@/editor/store';
import { PRESETS, useLayoutStore, type LayoutPreset } from '@/generate/layout';
import { useGenerateStore } from '@/generate/store';
import { useStartGenerate } from '@/generate/start';
import { useIsCompact } from '@/shell/viewport';
import { useTranslation } from '@/i18n';

/** The Generate workspace: parameters, canvas, batch rail, and the prompt composer beneath. */
/** Comfy Workflow is a mode of this workspace rather than its own destination: it is another way
 *  to drive the same generation. */
type WorkspaceMode = 'standard' | 'comfy';

/** Which of the three panes a narrow screen is showing. */
type Pane = 'image' | 'params' | 'batch';

export function GeneratePage() {
    const [mode, setMode] = useState<WorkspaceMode>('standard');
    const compact = useIsCompact();

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

    return compact ? (
        <StackedWorkspace mode={mode} onMode={setMode} />
    ) : (
        <SplitWorkspace mode={mode} onMode={setMode} />
    );
}

/** Parameters | canvas | batch, side by side and freely resizable. */
function SplitWorkspace(props: { mode: WorkspaceMode; onMode: (mode: WorkspaceMode) => void }) {
    const { t } = useTranslation();
    const paramsWidth = useLayoutStore(s => s.params);
    const batchWidth = useLayoutStore(s => s.batch);
    const resize = useLayoutStore(s => s.resize);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1">
                <aside
                    className="shrink-0 overflow-hidden border-r border-subtle bg-surface"
                    style={{ width: paramsWidth }}
                >
                    <ParamForm />
                </aside>
                <Splitter label={t('layout.resizeParams')} onResize={d => resize('params', d)} />

                <div className="flex min-w-0 flex-1 flex-col">
                    <WorkspaceHeader mode={props.mode} onMode={props.onMode} />
                    <CenterPane mode={props.mode} />
                </div>

                <Splitter label={t('layout.resizeBatch')} invert onResize={d => resize('batch', d)} />
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

/** The same workspace on a screen too narrow for three columns.
 *
 * The prompt, the generate button and the model/LoRA context stay pinned to the bottom - what
 * every run touches, and what a thumb reaches. The three panes above them take turns as tabs
 * rather than sharing the width; at 360px, three columns would leave the image about 90px.
 * Selecting a batch tile switches back to the image tab. */
function StackedWorkspace(props: { mode: WorkspaceMode; onMode: (mode: WorkspaceMode) => void }) {
    const { t } = useTranslation();
    const [pane, setPane] = useState<Pane>('image');
    const selected = useGenerateStore(s => s.selected);
    const batch = useGenerateStore(s => s.batch);
    const visibleBatch = batch.filter(item => item.status !== 'discarded').length;

    // Picking a tile is a request to look at that image, so the image is what comes up next.
    useEffect(() => {
        if (selected) {
            setPane(current => (current === 'batch' ? 'image' : current));
        }
    }, [selected]);

    const tabs: { id: Pane; label: string; badge?: number }[] = [
        { id: 'image', label: t('generate.pane.image') },
        { id: 'params', label: t('generate.pane.params') },
        { id: 'batch', label: t('generate.pane.batch'), badge: visibleBatch || undefined }
    ];

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div
                role="tablist"
                aria-label={t('generate.pane.label')}
                className="flex shrink-0 border-b border-subtle bg-surface"
            >
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        id={`gen-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        aria-selected={pane === tab.id}
                        aria-controls={`gen-pane-${tab.id}`}
                        onClick={() => setPane(tab.id)}
                        className={[
                            'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-sm transition-colors',
                            pane === tab.id
                                ? 'border-[var(--emphasis)] text-fg-strong'
                                : 'border-transparent text-fg-soft'
                        ].join(' ')}
                    >
                        {tab.label}
                        {tab.badge !== undefined && (
                            <span
                                className="rounded-full px-1.5 text-[10px] tabular-nums"
                                style={{ background: 'var(--sw-chip-bg)' }}
                            >
                                {tab.badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* All three stay mounted: the parameter form holds unsaved edits and the batch holds a
                live generation, neither of which may be thrown away by a tab switch. */}
            <div className="relative min-h-0 flex-1">
                <PanePanel id="image" active={pane === 'image'}>
                    <WorkspaceHeader mode={props.mode} onMode={props.onMode} compact />
                    <CenterPane mode={props.mode} />
                </PanePanel>
                <PanePanel id="params" active={pane === 'params'}>
                    <ParamForm />
                </PanePanel>
                <PanePanel id="batch" active={pane === 'batch'}>
                    <BatchRail />
                </PanePanel>
            </div>

            <ContextStrip />
            <PromptComposer />
        </div>
    );
}

/** What fills the middle column: the Comfy workflow, the image editor, or the plain viewer.
 *
 * The editor replaces the viewer rather than opening beside it - it already carries a viewer's
 * worth of pan and zoom, so a second copy of the same image would only cost width. */
function CenterPane(props: { mode: WorkspaceMode }) {
    const editorOpen = useEditorStore(s => s.open);
    if (props.mode === 'comfy') {
        return <ComfyWorkflow />;
    }
    return editorOpen ? <ImageEditor /> : <Canvas />;
}

/** One stacked pane. Hidden rather than unmounted, so switching tabs never costs state. */
function PanePanel(props: { id: Pane; active: boolean; children: React.ReactNode }) {
    return (
        <div
            role="tabpanel"
            id={`gen-pane-${props.id}`}
            aria-labelledby={`gen-tab-${props.id}`}
            className="absolute inset-0 flex min-h-0 flex-col bg-surface"
            hidden={!props.active}
            // Preflight's `[hidden]` rule is wrapped in `:where()`, so `flex` above outranks it.
            style={props.active ? undefined : { display: 'none' }}
        >
            {props.children}
        </div>
    );
}

function WorkspaceHeader(props: {
    mode: WorkspaceMode;
    onMode: (mode: WorkspaceMode) => void;
    /** Drops the pane-size presets, which have no panes to size in the stacked layout. */
    compact?: boolean;
}) {
    const { t } = useTranslation();

    return (
        <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-1">
            <div className="flex overflow-hidden rounded border border-default">
                {(
                    [
                        ['standard', 'generate.mode.standard'],
                        ['comfy', 'generate.mode.comfy']
                    ] as const
                ).map(([id, labelKey]) => (
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
                        {t(labelKey)}
                    </button>
                ))}
            </div>
            <div className="flex-1" />
            {!props.compact && <LayoutPresetMenu />}
        </div>
    );
}

/** Named pane arrangements for the split layout. Absent from the stacked layout, which has one
 *  pane on screen at a time and so nothing to arrange. */
function LayoutPresetMenu() {
    const { t } = useTranslation();
    const preset = useLayoutStore(s => s.preset);
    const applyPreset = useLayoutStore(s => s.applyPreset);

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <LayoutGrid size={13} aria-hidden />
                    {t('layout.title')}
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
                                {t(PRESETS[id].labelKey)}
                                {preset === id && (
                                    <span className="ml-2 text-xs text-fg-soft">
                                        {t('layout.current')}
                                    </span>
                                )}
                            </button>
                        </Popover.Close>
                    ))}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
