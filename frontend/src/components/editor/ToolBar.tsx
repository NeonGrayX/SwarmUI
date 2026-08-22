import * as Tooltip from '@radix-ui/react-tooltip';
import { useEditorStore, useEditorVersion } from '@/editor/store';
import { useTranslation } from '@/i18n';

/** The vertical tool strip down the left edge.
 *
 * Mask-only tools (the SAM2 pair) drop out of the strip while an image layer is selected, as they
 * do in the legacy editor - there is nothing for them to write to.
 *
 * It stays vertical at every width. A row of tools across the top would be the usual answer on a
 * phone, but the editor is already three horizontal bands deep there (header, options, layers) and
 * the canvas needs what height is left far more than it needs the 44px of width this costs. */
export function ToolBar(props: { compact?: boolean }) {
    const { t } = useTranslation();
    const engine = useEditorStore(s => s.engine);
    useEditorVersion();
    const tools = engine.getToolInfos().filter(tool => !tool.hidden);
    const activeId = engine.optionsTool.id;

    return (
        <Tooltip.Provider delayDuration={400}>
            <div
                role="toolbar"
                aria-orientation="vertical"
                aria-label={t('editor.tools')}
                className={[
                    'flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-subtle bg-surface p-1.5',
                    props.compact ? 'w-13' : 'w-11'
                ].join(' ')}
            >
                {tools.map(tool => {
                    const Icon = tool.icon;
                    const selected = tool.id === activeId;
                    return (
                        <Tooltip.Root key={tool.id}>
                            <Tooltip.Trigger asChild>
                                <button
                                    type="button"
                                    onClick={() => engine.activateTool(tool.id)}
                                    aria-pressed={selected}
                                    aria-label={t(tool.labelKey)}
                                    // A fingertip needs a target it can hit without aiming.
                                    className={[
                                        'rounded text-fg-soft transition-colors hover:text-fg hover:bg-[var(--sw-hover)]',
                                        props.compact ? 'p-2.5' : 'p-1.5'
                                    ].join(' ')}
                                    style={
                                        selected
                                            ? { background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }
                                            : undefined
                                    }
                                >
                                    <Icon size={props.compact ? 20 : 17} aria-hidden />
                                </button>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                                <Tooltip.Content
                                    side="right"
                                    align="start"
                                    collisionPadding={8}
                                    sideOffset={6}
                                    className="z-50 max-w-64 rounded border border-default bg-surface-raised px-2 py-1.5 text-xs shadow-xl"
                                >
                                    <span className="block font-medium text-fg-strong">
                                        {t(tool.labelKey)}
                                        {tool.hotkey && (
                                            <kbd className="ml-1.5 rounded border border-default px-1 font-mono text-[10px] uppercase text-fg-soft">
                                                {tool.hotkey}
                                            </kbd>
                                        )}
                                    </span>
                                    {/* The descriptions carry the modifier keys each tool honours,
                                        which is the only place they are documented. */}
                                    <span className="mt-0.5 block whitespace-pre-line text-fg-soft">
                                        {t(tool.descriptionKey)}
                                    </span>
                                </Tooltip.Content>
                            </Tooltip.Portal>
                        </Tooltip.Root>
                    );
                })}
            </div>
        </Tooltip.Provider>
    );
}
