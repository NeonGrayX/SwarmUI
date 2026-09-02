import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { libraryKeys } from '@/library/hooks';
import { useParamSchema } from '@/params/schema';
import { paramMapFrom, savableParams, type SavableParam } from '@/params/presets';
import { useGenerateStore } from '@/generate/store';
import { useTranslation } from '@/i18n';

/** Saves what the standard panel is set to right now as a preset.
 *
 * The point of the parameter list is that a preset is an overlay, not a snapshot: applying one
 * writes the parameters it names and leaves every other alone. So which parameters go in is the
 * decision that matters, and it is made here rather than guessed. What is ticked to begin with is
 * whatever has been moved off its default, which is the useful answer nearly every time - the
 * buttons above the list are there for the times it is not.
 */
export function PresetSaveDialog(props: {
    open: boolean;
    existing: string[];
    onClose: () => void;
    onNotice: (message: string, isError?: boolean) => void;
}) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const schema = useParamSchema();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [search, setSearch] = useState('');
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [useThumbnail, setUseThumbnail] = useState(false);
    const [busy, setBusy] = useState(false);

    // Read once per opening rather than subscribed: the list is a snapshot of what is being saved,
    // and having rows appear and vanish while the dialog is open would be its own problem.
    const items = useMemo(() => (props.open ? savableParams(schema) : []), [props.open, schema]);

    const currentImage = useGenerateStore(s => s.batch.find(item => item.id === s.selected));
    const thumbnailSrc = currentImage?.status === 'done' && !currentImage.isPreview ? currentImage.src : undefined;

    useEffect(() => {
        if (props.open) {
            setName('');
            setDescription('');
            setSearch('');
            setUseThumbnail(false);
            setChosen(new Set(items.filter(item => item.altered).map(item => item.param.id)));
        }
        // `items` is derived from the same `open` flip, so keying on it as well would only re-run
        // this with the identical result.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open]);

    const shown = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query
            ? items.filter(item => `${item.param.name} ${item.param.id} ${item.group}`.toLowerCase().includes(query))
            : items;
    }, [items, search]);

    const trimmed = name.trim();
    /** The stored preset this would replace, with its own capitalisation: the server looks a
     *  preset up by exact name, so editing "myPreset" over a stored "MyPreset" under the typed
     *  spelling would miss it and write a second entry beside it. */
    const overwriting = props.existing.find(existing => existing.toLowerCase() === trimmed.toLowerCase());

    function toggle(id: string): void {
        setChosen(current => {
            const next = new Set(current);
            if (!next.delete(id)) {
                next.add(id);
            }
            return next;
        });
    }

    async function save(): Promise<void> {
        setBusy(true);
        try {
            props.onNotice(t('presets.bar.saving'));
            const body: Record<string, unknown> = {
                title: trimmed,
                description,
                param_map: paramMapFrom(items, chosen),
                // Saving over an existing preset is an edit, or the server refuses the title.
                ...(overwriting ? { is_edit: true, editing: overwriting } : {})
            };
            if (useThumbnail && thumbnailSrc) {
                body.preview_image = await toJpegDataUrl(thumbnailSrc);
            }
            const result = await api.post<{ preset_fail?: string }>('AddNewPreset', body);
            if (result.preset_fail) {
                props.onNotice(result.preset_fail, true);
                return;
            }
            await queryClient.invalidateQueries({ queryKey: libraryKeys.userData });
            props.onNotice(t('presets.bar.saved'));
            props.onClose();
        }
        catch (e) {
            props.onNotice(e instanceof Error ? e.message : String(e), true);
        }
        finally {
            setBusy(false);
        }
    }

    return (
        <Dialog.Root open={props.open} onOpenChange={open => !open && props.onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[min(34rem,92vw)] -translate-x-1/2 flex-col rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <Dialog.Title className="mb-3 text-base font-medium text-fg-strong">
                        {t('presets.save.title')}
                    </Dialog.Title>

                    <label className="mb-1 block shrink-0 text-xs text-fg-soft" htmlFor="preset-save-name">
                        {t('presets.save.name')}
                    </label>
                    <input
                        id="preset-save-name"
                        type="text"
                        value={name}
                        autoFocus
                        list="preset-save-name-options"
                        placeholder={t('presets.save.namePlaceholder')}
                        onChange={e => setName(e.target.value)}
                        className="w-full shrink-0 rounded border border-default bg-surface-sunken px-2 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                    <datalist id="preset-save-name-options">
                        {props.existing.map(existing => (
                            <option key={existing} value={existing} />
                        ))}
                    </datalist>
                    {overwriting && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--backend-errored)' }}>
                            {t('presets.save.overwrite', { name: overwriting })}
                        </p>
                    )}

                    <label className="mb-1 mt-3 block shrink-0 text-xs text-fg-soft" htmlFor="preset-save-description">
                        {t('presets.save.description')}
                    </label>
                    <textarea
                        id="preset-save-description"
                        value={description}
                        rows={3}
                        placeholder={t('presets.save.descriptionPlaceholder')}
                        onChange={e => setDescription(e.target.value)}
                        className="w-full shrink-0 resize-y rounded border border-default bg-surface-sunken px-2 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />

                    <div className="mb-1 mt-3 flex shrink-0 flex-wrap items-center gap-2">
                        <span className="text-xs text-fg-soft">
                            {t('presets.save.included', { count: chosen.size })}
                        </span>
                        <span className="ml-auto flex gap-1">
                            <QuickPick
                                label={t('presets.save.pickAll')}
                                onClick={() => setChosen(new Set(items.map(item => item.param.id)))}
                            />
                            <QuickPick
                                label={t('presets.save.pickChanged')}
                                onClick={() =>
                                    setChosen(new Set(items.filter(item => item.altered).map(item => item.param.id)))
                                }
                            />
                            <QuickPick label={t('presets.save.pickNone')} onClick={() => setChosen(new Set())} />
                        </span>
                    </div>
                    <input
                        type="search"
                        value={search}
                        placeholder={t('presets.save.searchPlaceholder')}
                        onChange={e => setSearch(e.target.value)}
                        aria-label={t('presets.save.searchPlaceholder')}
                        className="mb-1.5 w-full shrink-0 rounded border border-default bg-surface-sunken px-2 py-1 text-xs text-fg outline-none focus:border-[var(--emphasis)]"
                    />

                    <div className="min-h-[6rem] flex-1 overflow-y-auto rounded border border-default bg-surface-sunken p-1">
                        {shown.length === 0 ? (
                            <p className="p-2 text-xs text-fg-soft">
                                {items.length === 0 ? t('presets.loading') : t('presets.save.noParams')}
                            </p>
                        ) : (
                            shown.map(item => (
                                <ParamRow
                                    key={item.param.id}
                                    item={item}
                                    checked={chosen.has(item.param.id)}
                                    onToggle={() => toggle(item.param.id)}
                                />
                            ))
                        )}
                    </div>

                    <label
                        htmlFor="preset-save-thumb"
                        className={`mt-3 flex shrink-0 items-center gap-2 text-sm ${thumbnailSrc ? 'text-fg' : 'text-fg-soft opacity-60'}`}
                    >
                        <input
                            id="preset-save-thumb"
                            type="checkbox"
                            checked={useThumbnail}
                            disabled={!thumbnailSrc}
                            onChange={e => setUseThumbnail(e.target.checked)}
                        />
                        {t('presets.save.useImage')}
                    </label>

                    <div className="mt-4 flex shrink-0 justify-end gap-2">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {t('common.cancel')}
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            onClick={save}
                            disabled={!trimmed || chosen.size === 0 || busy}
                            title={chosen.size === 0 ? t('presets.save.needParam') : undefined}
                            className="rounded px-3 py-1.5 text-sm disabled:opacity-50"
                            style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                        >
                            {busy ? t('common.saving') : t('presets.bar.save')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function QuickPick(props: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className="rounded border border-default px-1.5 py-0.5 text-[11px] text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
        >
            {props.label}
        </button>
    );
}

/** One parameter offered to the preset. The value is shown because "steps" means nothing without
 *  it - the decision being made is whether to carry *this* value, not the parameter in the abstract. */
function ParamRow(props: { item: SavableParam; checked: boolean; onToggle: () => void }) {
    const { param, value, group, altered } = props.item;
    return (
        <label
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-[var(--sw-hover)]"
            title={`${param.id}${group ? ` — ${group}` : ''}`}
        >
            <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
            <span className={`min-w-0 flex-1 truncate ${altered ? 'text-fg-strong' : 'text-fg'}`}>{param.name}</span>
            <span className="max-w-[45%] shrink-0 truncate text-fg-soft" style={{ direction: 'rtl' }}>
                {value === '' ? '—' : value}
            </span>
        </label>
    );
}

/** A generated image comes back under `/View/...` when output paths carry the user name, and the
 *  server takes a preset preview only as a JPEG data string or an `/Output` path
 *  (BasicAPIFeatures.cs:479) - so it is re-encoded here rather than passed along as a path. Scaled
 *  down on the way, since what it becomes is a thumbnail in a browser. */
async function toJpegDataUrl(src: string): Promise<string> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('preview-load-failed'));
        element.src = src;
    });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('preview-encode-failed');
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
}
