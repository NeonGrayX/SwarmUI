import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Save } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { comfyKeys, useSavedWorkflows, type ComfyBuildResult } from '@/comfy/actions';
import { IconButton, SELECT_CLASS, type ComfyNotice } from './ComfyBarParts';
import { ComfySaveDialog, type ReplaceTarget } from './ComfySaveDialog';
import { ComfyWorkflowLibrary } from './ComfyWorkflowLibrary';
import { useTranslation } from '@/i18n';

/** The workflow library, as a strip of three controls: save what is open, browse what is stored,
 *  reopen one by name.
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
    const [libraryOpen, setLibraryOpen] = useState(false);
    /** Pre-fills the save dialog when the library asked to save over an existing workflow. */
    const [replacing, setReplacing] = useState<ReplaceTarget | null>(null);

    const canEdit = usePermission('comfy_edit_workflows');
    const canRead = usePermission('comfy_read_workflows');
    const saved = useSavedWorkflows(canRead);
    const names = saved.data?.workflows.map(w => w.name) ?? [];

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
            <IconButton
                onClick={() => {
                    setReplacing(null);
                    setSaveOpen(true);
                }}
                disabled={!canEdit}
                label={t('comfy.bar.save')}
            >
                <Save size={13} aria-hidden />
            </IconButton>
            <IconButton onClick={() => setLibraryOpen(true)} disabled={!canRead} label={t('comfy.bar.browse')}>
                <FolderOpen size={13} aria-hidden />
            </IconButton>
            <QuickLoad names={names} disabled={!canRead} onPick={props.onLoad} />

            <ComfySaveDialog
                open={saveOpen}
                replacing={replacing}
                existingNames={names}
                onClose={() => setSaveOpen(false)}
                onNotice={props.notice.show}
                build={props.build}
            />
            <ComfyWorkflowLibrary
                open={libraryOpen}
                onClose={() => setLibraryOpen(false)}
                canEdit={canEdit}
                onOpenWorkflow={name => {
                    setLibraryOpen(false);
                    props.onLoad(name);
                }}
                onReplace={workflow => {
                    setLibraryOpen(false);
                    setReplacing({
                        name: workflow.name,
                        description: workflow.description ?? '',
                        simple: workflow.enable_in_simple
                    });
                    setSaveOpen(true);
                }}
                onDelete={deleteWorkflow}
            />
        </>
    );
}

/** Reopens a saved workflow without leaving the current mode. Resets to its label after each pick,
 *  so choosing the same workflow twice in a row still loads it. */
function QuickLoad(props: { names: string[]; disabled?: boolean; onPick: (name: string) => void }) {
    const { t } = useTranslation();
    return (
        <select
            className={SELECT_CLASS}
            value=""
            disabled={props.disabled || props.names.length === 0}
            aria-label={t('comfy.bar.quickLoad')}
            onChange={e => {
                if (e.target.value) {
                    props.onPick(e.target.value);
                }
            }}
        >
            <option value="">{t('comfy.bar.quickLoad')}</option>
            {props.names.map(name => (
                <option key={name} value={name}>
                    {name}
                </option>
            ))}
        </select>
    );
}
