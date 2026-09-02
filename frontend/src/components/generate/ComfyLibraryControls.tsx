import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { comfyKeys, useSavedWorkflows, type ComfyBuildResult } from '@/comfy/actions';
import { IconButton, type ComfyNotice } from './ComfyBarParts';
import { ComfySaveDialog } from './ComfySaveDialog';
import { WorkflowPicker } from './WorkflowPicker';
import { useTranslation } from '@/i18n';

/** The workflow library, as a strip of two controls: save what is open, reopen one by name.
 *
 * Kept apart from the bar around it so that what a workflow is - a graph, with an editor behind it
 * - stays separate from the library's own business of naming and storing one.
 */
export function ComfyLibraryControls(props: {
    notice: ComfyNotice;
    /** Produces what a save would write. */
    build: (requireSave: boolean) => Promise<ComfyBuildResult>;
    /** Opens a saved workflow, wherever this bar's workflows go. */
    onLoad: (name: string) => void;
}) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [saveOpen, setSaveOpen] = useState(false);

    const canEdit = usePermission('comfy_edit_workflows');
    const canRead = usePermission('comfy_read_workflows');
    const saved = useSavedWorkflows(canRead);
    const workflows = saved.data?.workflows ?? [];
    const names = workflows.map(w => w.name);

    const deleteWorkflow = async (name: string) => {
        try {
            props.notice.show(t('comfy.notice.deleting'));
            await api.post('ComfyDeleteWorkflow', { name });
            await queryClient.invalidateQueries({ queryKey: comfyKeys.workflows });
            props.notice.show(t('comfy.notice.deleted'));
        }
        catch (e) {
            props.notice.show(e instanceof Error ? e.message : String(e), true);
        }
    };

    return (
        <>
            <IconButton onClick={() => setSaveOpen(true)} disabled={!canEdit} label={t('comfy.bar.save')}>
                <Save size={13} aria-hidden />
            </IconButton>
            {/* Quick load reopens a workflow rather than settling on one, so the picker holds no
                selection: it goes back to reading "Quick load", and picking the same workflow twice
                in a row loads it twice. */}
            <WorkflowPicker
                label={t('comfy.bar.quickLoad')}
                workflows={workflows}
                loading={saved.isPending}
                error={
                    saved.isError
                        ? saved.error instanceof Error
                            ? saved.error.message
                            : t('workflows.loadFailed')
                        : null
                }
                disabled={!canRead}
                prefsKey="swarm-ui-comfy-quick-load-picker"
                onDelete={canEdit ? name => void deleteWorkflow(name) : undefined}
                emptyText={t('workflows.none')}
                emptyHint={t('workflows.noneHint')}
                onPick={props.onLoad}
            />

            <ComfySaveDialog
                open={saveOpen}
                existingNames={names}
                onClose={() => setSaveOpen(false)}
                onNotice={props.notice.show}
                build={props.build}
            />
        </>
    );
}
