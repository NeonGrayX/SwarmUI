import { Settings2, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { imageUrl, useGenerateStore } from '@/generate/store';
import type { BatchItem } from '@/generate/types';
import { OutputThumbnail } from '../ui/OutputMedia';
import { DisconnectedNotice } from './DisconnectedNotice';
import { useTranslation } from '@/i18n';

/** The batch strip: one tile per image in the run, with live progress. */
export function BatchRail() {
    const { t } = useTranslation();
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
                <h2 className="text-xs font-medium text-fg-strong">{t('batch.title')}</h2>
                {visible.length > 0 && <span className="text-xs text-fg-soft">{visible.length}</span>}
                <div className="flex-1" />
                {visible.length > 0 && (
                    <button
                        type="button"
                        onClick={clearBatch}
                        aria-label={t('generate.menu.clearBatch')}
                        title={t('generate.menu.clearBatch')}
                        className="rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                    >
                        <X size={13} aria-hidden />
                    </button>
                )}
                <Popover.Root>
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            aria-label={t('batch.settings')}
                            title={t('batch.settings')}
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
                                label={t('batch.autoSwap')}
                                checked={autoSwap}
                                onChange={setAutoSwap}
                            />
                            <Toggle
                                label={t('batch.autoClear')}
                                checked={autoClear}
                                onChange={setAutoClear}
                            />
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                <DisconnectedNotice className="mb-2" />
                {visible.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-fg-soft">
                        {t('batch.empty')}
                    </p>
                ) : (
                    // Sized by the container rather than by a column count: the same grid backs a
                    // 200px rail on the desktop layout and a full-width pane on the stacked one.
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1.5">
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

/** Message identifier for what became of a slot, or null while it is still working - in which
 *  case the tile shows its progress instead. */
function outcomeKey(item: BatchItem): string | null {
    switch (item.status) {
        case 'failed':
            return 'batch.failed';
        case 'cancelled':
            return 'batch.cancelled';
        // Not a failure: the server carries on generating through a dropped connection, so this
        // slot's image is most likely finished and sitting in the history.
        case 'disconnected':
            return 'batch.disconnected';
        default:
            return null;
    }
}

function BatchTile(props: { item: BatchItem; active: boolean; onSelect: () => void }) {
    const { t } = useTranslation();
    const { item } = props;
    const src = imageUrl(item.src);
    const percent = Math.round((item.overallPercent ?? 0) * 100);
    const outcome = outcomeKey(item);

    return (
        <button
            type="button"
            onClick={props.onSelect}
            aria-current={props.active ? 'true' : undefined}
            title={
                item.error ??
                (item.status === 'disconnected'
                    ? t('batch.disconnectedHint')
                    : t('batch.imageNumber', { index: item.batchIndex }))
            }
            className="relative aspect-square overflow-hidden rounded border transition-colors"
            style={{
                borderColor: props.active ? 'var(--emphasis)' : 'var(--light-border)',
                background: 'var(--sw-surface-sunken)'
            }}
        >
            {src ? (
                <OutputThumbnail
                    src={src}
                    alt={t('batch.imageAlt', { index: item.batchIndex })}
                    className="h-full w-full object-cover"
                    style={item.isPreview ? { opacity: 0.75 } : undefined}
                />
            ) : (
                <span className="flex h-full items-center justify-center text-[10px] text-fg-soft">
                    {outcome ? t(outcome) : `${percent}%`}
                </span>
            )}

            {/* A slot that stopped mid-run keeps whatever preview it had reached, so the outcome
                has to be said over the top of it rather than in place of it. */}
            {src && outcome && (
                <span className="absolute inset-x-0 bottom-0 bg-[color-mix(in_srgb,black_60%,transparent)] py-0.5 text-center text-[10px] text-white">
                    {t(outcome)}
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
