import { Settings2, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { imageUrl, useGenerateStore } from '@/generate/store';
import type { BatchItem } from '@/generate/types';

/** The batch strip: one tile per image in the run, with live progress. */
export function BatchRail() {
    const batch = useGenerateStore(s => s.batch);
    const selected = useGenerateStore(s => s.selected);
    const select = useGenerateStore(s => s.select);
    const clearBatch = useGenerateStore(s => s.clearBatch);
    const autoSwap = useGenerateStore(s => s.autoSwapToImages);
    const setAutoSwap = useGenerateStore(s => s.setAutoSwapToImages);
    const autoClear = useGenerateStore(s => s.autoClearBatch);
    const setAutoClear = useGenerateStore(s => s.setAutoClearBatch);

    const visible = batch.filter(item => item.status !== 'discarded');

    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-subtle px-2 py-1.5">
                <h2 className="text-xs font-medium text-fg-strong">Batch</h2>
                {visible.length > 0 && <span className="text-xs text-fg-soft">{visible.length}</span>}
                <div className="flex-1" />
                {visible.length > 0 && (
                    <button
                        type="button"
                        onClick={clearBatch}
                        aria-label="Clear batch"
                        title="Clear batch"
                        className="rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        <X size={13} aria-hidden />
                    </button>
                )}
                <Popover.Root>
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            aria-label="Batch settings"
                            title="Batch settings"
                            className="rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <Settings2 size={13} aria-hidden />
                        </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content
                            side="left"
                            align="start"
                            sideOffset={6}
                            className="z-50 w-60 rounded-lg border border-default bg-surface-raised p-2 shadow-xl space-y-1"
                        >
                            <Toggle
                                label="Auto-swap to new images"
                                checked={autoSwap}
                                onChange={setAutoSwap}
                            />
                            <Toggle
                                label="Auto-clear batch on generate"
                                checked={autoClear}
                                onChange={setAutoClear}
                            />
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {visible.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-fg-soft">
                        Generated images appear here.
                    </p>
                ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                        {visible.map(item => (
                            <BatchTile
                                key={item.id}
                                item={item}
                                active={item.id === selected}
                                onSelect={() => select(item.id)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function BatchTile(props: { item: BatchItem; active: boolean; onSelect: () => void }) {
    const { item } = props;
    const src = imageUrl(item.src);
    const percent = Math.round((item.overallPercent ?? 0) * 100);

    return (
        <button
            type="button"
            onClick={props.onSelect}
            aria-current={props.active ? 'true' : undefined}
            title={item.error ?? `Image ${item.batchIndex}`}
            className="relative aspect-square overflow-hidden rounded border transition-colors"
            style={{
                borderColor: props.active ? 'var(--emphasis)' : 'var(--light-border)',
                background: 'var(--sw-surface-sunken)'
            }}
        >
            {src ? (
                <img
                    src={src}
                    alt={`Batch image ${item.batchIndex}`}
                    className="h-full w-full object-cover"
                    style={item.isPreview ? { opacity: 0.75 } : undefined}
                />
            ) : (
                <span className="flex h-full items-center justify-center text-[10px] text-fg-soft">
                    {item.status === 'failed' ? 'failed' : `${percent}%`}
                </span>
            )}

            {item.status === 'running' && (
                <span
                    className="absolute inset-x-0 bottom-0 h-0.5"
                    style={{ width: `${percent}%`, background: 'var(--emphasis)' }}
                />
            )}
        </button>
    );
}

function Toggle(props: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
    return (
        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-fg hover:bg-[var(--sw-hover)]">
            <input
                type="checkbox"
                checked={props.checked}
                onChange={e => props.onChange(e.target.checked)}
                className="accent-[var(--emphasis)]"
            />
            {props.label}
        </label>
    );
}
