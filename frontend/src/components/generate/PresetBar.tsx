import { useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronDown, Download, Star, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import {
    PickerCard,
    PickerChip,
    PickerGroup,
    PickerRow,
    PickerSearch,
    PickerStar,
    PickerViewToggle,
    usePickerPrefs
} from '@/components/form/PickerParts';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    insideContextMenu,
    useContextMenu,
    type ContextMenuHandle,
    type MenuAction
} from '@/components/ui/ContextMenu';
import { libraryKeys, useMyUserData } from '@/library/hooks';
import { usePresetStars } from '@/library/stars';
import { previewUrl, type PresetEntry } from '@/library/types';
import { useParamSchema } from '@/params/schema';
import { applyPresetMap, importBody, parsePresetFile } from '@/params/presets';
import { ComfyNoticeText, IconButton, useComfyNotice } from './ComfyBarParts';
import { PresetSaveDialog } from './PresetSaveDialog';
import { useTranslation } from '@/i18n';

/** The preset library, in the standard workspace mode: keep the current settings, put a kept set
 *  back, and move them between installs as a file.
 *
 * This is the counterpart of the workflow library beside it. A workflow is a graph and belongs to
 * the Comfy mode; a preset is a handful of ordinary parameter values and belongs here, where those
 * parameters are. Everything it does goes through the preset routes the server already has, so
 * what is written is what the Presets library and the existing interface already read.
 */
export function PresetBar() {
    const { t } = useTranslation();
    const notice = useComfyNotice();
    const queryClient = useQueryClient();
    const schema = useParamSchema();
    const fileInput = useRef<HTMLInputElement>(null);
    const [saveOpen, setSaveOpen] = useState(false);

    const canManage = usePermission('manage_presets');
    const userData = useMyUserData();
    const presets = userData.data?.presets ?? [];
    const titles = useMemo(
        () => presets.map(preset => preset.title).sort((a, b) => a.localeCompare(b)),
        [presets]
    );

    function apply(title: string): void {
        const preset = presets.find(entry => entry.title === title);
        if (!preset) {
            return;
        }
        applyPresetMap(preset.param_map, schema);
        notice.show(t('presets.bar.applied', { name: preset.title }));
    }

    /** Removes a preset, from the dropdown's own right-click menu, so a preset that has outlived
     *  its use can go without a trip to the Presets library. Applying one is an overlay on the
     *  panel, but this is not: it is gone for good, which is why the dropdown confirms first. */
    async function remove(title: string): Promise<void> {
        try {
            await api.post('DeletePreset', { preset: title });
            await queryClient.invalidateQueries({ queryKey: libraryKeys.userData });
            notice.show(t('presets.bar.deleted', { name: title }));
        }
        catch (e) {
            notice.show(e instanceof Error ? e.message : String(e), true);
        }
    }

    /** Writes every preset to a file, previews and all, in the shape ExportUserPresets returns. */
    async function exportAll(): Promise<void> {
        try {
            notice.show(t('presets.bar.exporting'));
            const data = await api.post<{ presets: PresetEntry[] }>('ExportUserPresets', {});
            const blob = new Blob([JSON.stringify(data, null, 4)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'swarmui-presets.json';
            link.click();
            URL.revokeObjectURL(url);
            notice.show(t('presets.bar.exported', { count: data.presets?.length ?? 0 }));
        }
        catch (e) {
            notice.show(e instanceof Error ? e.message : String(e), true);
        }
    }

    /** Adds every preset in a file. One request each, because AddNewPreset takes one at a time.
     *
     * A title already in use is left alone rather than overwritten - an import should not be able
     * to quietly replace something that took work to set up - and is counted so the result says so
     * instead of looking like a partial failure. */
    async function importFile(file: File): Promise<void> {
        try {
            notice.show(t('presets.bar.importing'));
            const incoming = parsePresetFile(await file.text());
            const taken = new Set(presets.map(preset => preset.title.toLowerCase()));
            let added = 0;
            let skipped = 0;
            for (const preset of incoming) {
                if (taken.has(preset.title.toLowerCase())) {
                    skipped++;
                    continue;
                }
                const result = await api.post<{ preset_fail?: string }>('AddNewPreset', importBody(preset));
                if (result.preset_fail) {
                    skipped++;
                    continue;
                }
                added++;
            }
            await queryClient.invalidateQueries({ queryKey: libraryKeys.userData });
            notice.show(
                skipped > 0
                    ? t('presets.bar.importedSome', { added, skipped })
                    : t('presets.bar.imported', { count: added }),
                added === 0
            );
        }
        catch (e) {
            notice.show(e instanceof Error && e.message === 'not-presets'
                ? t('presets.error.notPresets')
                : e instanceof Error ? e.message : String(e), true);
        }
    }

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <IconButton
                onClick={() => setSaveOpen(true)}
                disabled={!canManage}
                label={t('presets.bar.save')}
                hint={canManage ? t('presets.bar.saveHint') : undefined}
            >
                <Bookmark size={13} aria-hidden />
            </IconButton>
            <IconButton
                onClick={() => fileInput.current?.click()}
                disabled={!canManage}
                label={t('presets.bar.import')}
            >
                <Upload size={13} aria-hidden />
            </IconButton>
            <IconButton
                onClick={() => void exportAll()}
                disabled={presets.length === 0}
                label={t('presets.bar.export')}
            >
                <Download size={13} aria-hidden />
            </IconButton>
            <PresetDropdown
                presets={presets}
                loading={userData.isPending}
                onPick={apply}
                onDelete={canManage ? title => void remove(title) : undefined}
            />

            {/* Kept out of the button so the button stays a button; clicking it opens this. */}
            <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={e => {
                    const file = e.target.files?.[0];
                    // Cleared straight away, so importing the same file twice in a row still fires.
                    e.target.value = '';
                    if (file) {
                        void importFile(file);
                    }
                }}
            />

            <PresetSaveDialog
                open={saveOpen}
                existing={titles}
                onClose={() => setSaveOpen(false)}
                onNotice={notice.show}
            />
            <ComfyNoticeText notice={notice} />
        </div>
    );
}

/** Applies a preset without leaving the panel, out of the same dropdown the Simple workspace picks
 *  a workflow from - search, stars, and a thumbnail apiece.
 *
 * Unlike those pickers this one holds no selection: applying a preset is an overlay on whatever is
 * in the panel, which the next edit can undo, so there is nothing for it to go on showing. That is
 * also why picking the same preset twice in a row applies it twice.
 *
 * Right-clicking an entry offers what can be done to the preset itself rather than with it -
 * starring it, and deleting it where the user may manage presets.
 */
function PresetDropdown(props: {
    presets: PresetEntry[];
    loading: boolean;
    onPick: (title: string) => void;
    /** Deletes a preset, for the right-click menu. Left out where the user may not. Confirmation
     *  happens here, before this is called. */
    onDelete?: (title: string) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const contextMenu = useContextMenu();

    return (
        <>
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={t('presets.bar.quickApply')}
                        className="flex w-40 max-w-full items-center gap-1.5 rounded border border-default bg-surface-sunken px-1.5 py-0.5 text-left text-xs text-fg outline-none hover:border-[var(--emphasis)] focus:border-[var(--emphasis)]"
                    >
                        <span className="min-w-0 flex-1 truncate text-fg-soft">{t('presets.bar.quickApply')}</span>
                        <ChevronDown size={13} aria-hidden className="shrink-0 text-fg-soft" />
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        align="start"
                        sideOffset={4}
                        collisionPadding={8}
                        // The right-click menu is a popup of its own, so using it reads as a click away
                        // from this list; without this the list would close under the menu it opened.
                        onInteractOutside={event => {
                            if (insideContextMenu(event.target)) {
                                event.preventDefault();
                            }
                        }}
                        className="z-50 w-[min(28rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl"
                    >
                        <PresetOptionList
                            presets={props.presets}
                            loading={props.loading}
                            menu={contextMenu}
                            onPick={title => {
                                props.onPick(title);
                                setOpen(false);
                            }}
                            onDelete={
                                props.onDelete &&
                                (title => {
                                    // The confirmation is a modal dialog, and a list left open behind
                                    // it is a list the user cannot get back to until they answer.
                                    setOpen(false);
                                    setPendingDelete(title);
                                })
                            }
                        />
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>

            {contextMenu.menu}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t('presets.deleteTitle')}
                body={
                    <>
                        {t('presets.deleteBodyBefore')} <strong className="text-fg">{pendingDelete}</strong>{' '}
                        {t('presets.deleteBodyAfter')}
                    </>
                }
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    const title = pendingDelete;
                    setPendingDelete(null);
                    if (title) {
                        props.onDelete?.(title);
                    }
                }}
                onCancel={() => setPendingDelete(null)}
            />
        </>
    );
}

/** The searchable body of the dropdown: the same cards, rows, search and scrolling the model and
 *  workflow pickers use, over the presets GetMyUserData already brought down with the rest of the
 *  user's data - so opening it costs no request. */
function PresetOptionList(props: {
    presets: PresetEntry[];
    loading: boolean;
    onPick: (title: string) => void;
    onDelete?: (title: string) => void;
    menu: ContextMenuHandle;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const prefs = usePickerPrefs('swarm-ui-preset-picker');
    const stars = usePresetStars();
    const onDelete = props.onDelete;

    // Starred first, then by title - the same rule the other pickers follow, so the presets worth
    // reaching for are the ones already on screen when the list opens.
    const matches = useMemo(() => {
        const query = search.trim().toLowerCase();
        const shown = props.presets.filter(preset => {
            if (prefs.starredOnly && !stars.isStarred(preset.title)) {
                return false;
            }
            return !query || `${preset.title}\n${preset.description ?? ''}`.toLowerCase().includes(query);
        });
        return shown.sort(
            (a, b) =>
                Number(stars.isStarred(b.title)) - Number(stars.isStarred(a.title))
                || a.title.localeCompare(b.title)
        );
    }, [props.presets, search, prefs.starredOnly, stars]);

    return (
        <Command shouldFilter={false} loop label={t('presets.bar.quickApply')}>
            <div className="border-b border-subtle p-2">
                <PickerSearch
                    value={search}
                    onChange={setSearch}
                    placeholder={t('presets.picker.searchPlaceholder')}
                />
                <div className="mt-2 flex items-center gap-1">
                    <PickerChip
                        pressed={prefs.starredOnly}
                        onToggle={() => prefs.setStarredOnly(!prefs.starredOnly)}
                        title={t('modelPicker.starredOnlyHint')}
                        label={t('modelPicker.starred')}
                    >
                        <Star size={11} aria-hidden fill={prefs.starredOnly ? 'currentColor' : 'none'} />
                    </PickerChip>
                    <div className="flex-1" />
                    <PickerViewToggle view={prefs.view} onView={prefs.setView} />
                </div>
            </div>

            <Command.List className="max-h-80 overflow-y-auto p-2">
                {props.loading ? (
                    <p className="px-2 py-6 text-center text-sm text-fg-soft">{t('common.loading')}</p>
                ) : (
                    matches.length === 0 && (
                        <div className="px-2 py-6 text-center text-sm text-fg-soft">
                            <p>
                                {props.presets.length === 0
                                    ? t('presets.noneSaved')
                                    : prefs.starredOnly && stars.count === 0
                                      ? t('presets.noneStarred')
                                      : t('presets.picker.noMatches')}
                            </p>
                            {props.presets.length === 0 && (
                                <p className="mt-1 text-xs">{t('presets.noneSavedHint')}</p>
                            )}
                        </div>
                    )
                )}

                <PickerGroup view={prefs.view}>
                    {matches.map(preset => {
                        const starred = stars.isStarred(preset.title);
                        const menuActions: MenuAction[] = [
                            {
                                label: starred ? t('common.unstar') : t('common.star'),
                                onSelect: () => stars.toggle(preset.title)
                            }
                        ];
                        if (onDelete) {
                            menuActions.push({
                                label: t('common.delete'),
                                destructive: true,
                                separated: true,
                                onSelect: () => onDelete(preset.title)
                            });
                        }
                        const shared = {
                            value: preset.title,
                            onPick: () => props.onPick(preset.title),
                            tooltip: preset.description || preset.title,
                            picked: false,
                            preview: previewUrl(preset.preview_image),
                            title: preset.title,
                            subtitle:
                                preset.description
                                || t('presets.paramCountShort', {
                                    count: Object.keys(preset.param_map ?? {}).length
                                }),
                            onContextMenu: (event: React.MouseEvent) => props.menu.open(event, menuActions),
                            longPress: props.menu.touch(menuActions)
                        };
                        return prefs.view === 'grid' ? (
                            <PickerCard
                                key={preset.title}
                                {...shared}
                                actions={
                                    <PickerStar
                                        starred={starred}
                                        onStar={() => stars.toggle(preset.title)}
                                        overlay
                                    />
                                }
                            />
                        ) : (
                            <PickerRow
                                key={preset.title}
                                {...shared}
                                actions={
                                    <PickerStar starred={starred} onStar={() => stars.toggle(preset.title)} />
                                }
                            />
                        );
                    })}
                </PickerGroup>
            </Command.List>

            <div className="flex items-center gap-2 border-t border-subtle px-3 py-1.5 text-xs text-fg-soft">
                <span>
                    {t('modelPicker.countOf', { shown: matches.length, total: props.presets.length })}
                </span>
            </div>
        </Command>
    );
}
