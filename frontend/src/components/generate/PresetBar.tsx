import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, Download, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { libraryKeys, useMyUserData } from '@/library/hooks';
import type { PresetEntry } from '@/library/types';
import { useParamSchema } from '@/params/schema';
import { applyPresetMap, importBody, parsePresetFile } from '@/params/presets';
import { ComfyNoticeText, IconButton, SELECT_CLASS, useComfyNotice } from './ComfyBarParts';
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
    const titles = presets.map(preset => preset.title).sort((a, b) => a.localeCompare(b));

    function apply(title: string): void {
        const preset = presets.find(entry => entry.title === title);
        if (!preset) {
            return;
        }
        applyPresetMap(preset.param_map, schema);
        notice.show(t('presets.bar.applied', { name: preset.title }));
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
            <QuickApply names={titles} onPick={apply} />

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

/** Applies a preset without leaving the panel. Resets to its label after each pick, so choosing
 *  the same preset twice in a row applies it twice - which matters, since applying one is an
 *  overlay that a later edit can undo. */
function QuickApply(props: { names: string[]; onPick: (name: string) => void }) {
    const { t } = useTranslation();
    return (
        <select
            className={SELECT_CLASS}
            value=""
            disabled={props.names.length === 0}
            aria-label={t('presets.bar.quickApply')}
            onChange={e => {
                if (e.target.value) {
                    props.onPick(e.target.value);
                }
            }}
        >
            <option value="">{t('presets.bar.quickApply')}</option>
            {props.names.map(name => (
                <option key={name} value={name}>
                    {name}
                </option>
            ))}
        </select>
    );
}
