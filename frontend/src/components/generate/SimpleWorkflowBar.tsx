import { useMemo } from 'react';
import { useSavedWorkflows } from '@/comfy/actions';
import { useSimpleWorkflowStore, type SimpleWorkflowSession } from '@/comfy/simple';
import { WorkflowPicker } from './WorkflowPicker';
import { useTranslation } from '@/i18n';

/** The Simple workspace's own tools, in the strip beside the mode switch: which workflow is
 *  driving the panel, and how to reach for another.
 *
 * Sharing that strip is what lets the workspace below stay exactly the standard one - parameters,
 * canvas and batch - with the workflow's controls in place of Swarm's own. Choosing among the
 * workflows works the way choosing a model does, out of the shared workflow picker, so this and
 * the Comfy bar's Quick load are one habit rather than two.
 */
export function SimpleWorkflowBar(props: { session: SimpleWorkflowSession }) {
    const { t } = useTranslation();

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <WorkflowDropdown />
            {props.session.loading && (
                <p className="text-xs text-fg-soft" role="status">
                    {t('simple.loading')}
                </p>
            )}
            {props.session.error && (
                <p
                    className="max-w-[16rem] truncate text-xs"
                    style={{ color: 'var(--backend-errored)' }}
                    title={props.session.error}
                    role="status"
                >
                    {props.session.error}
                </p>
            )}
        </div>
    );
}

/** The workflows this dropdown offers are the ones their authors marked as fit to be driven by
 *  their own controls: saved with "Show in the Simple tab" ticked, or carrying a
 *  SwarmWorkflowDescription node that says so - the same `enable_in_simple` flag the existing
 *  interface's Simple tab filters on (simpletab.js:browserListEntries). */
function WorkflowDropdown() {
    const { t } = useTranslation();
    const workflow = useSimpleWorkflowStore(s => s.workflow);
    const select = useSimpleWorkflowStore(s => s.select);
    const saved = useSavedWorkflows(true);

    const workflows = useMemo(
        () => (saved.data?.workflows ?? []).filter(w => w.enable_in_simple),
        [saved.data]
    );

    return (
        <WorkflowPicker
            label={t('simple.bar.quickPick')}
            workflows={workflows}
            loading={saved.isPending}
            error={
                saved.isError
                    ? saved.error instanceof Error
                        ? saved.error.message
                        : t('simple.loadFailed')
                    : null
            }
            current={workflow}
            prefsKey="swarm-ui-simple-workflow-picker"
            emptyText={t('simple.picker.empty')}
            emptyHint={t('simple.picker.emptyHint')}
            className="w-56"
            onPick={select}
        />
    );
}
