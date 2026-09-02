import { LayoutGrid } from 'lucide-react';
import { useSavedWorkflows } from '@/comfy/actions';
import { useSimpleWorkflowStore, type SimpleWorkflowSession } from '@/comfy/simple';
import { IconButton, SELECT_CLASS } from './ComfyBarParts';
import { useTranslation } from '@/i18n';

/** The Simple workspace's own tools, in the strip beside the mode switch: which workflow is
 *  driving the panel, and how to reach for another.
 *
 * Sharing that strip is what lets the workspace below stay exactly the standard one - parameters,
 * canvas and batch - with the workflow's controls in place of Swarm's own.
 */
export function SimpleWorkflowBar(props: { session: SimpleWorkflowSession }) {
    const { t } = useTranslation();
    const workflow = useSimpleWorkflowStore(s => s.workflow);
    const select = useSimpleWorkflowStore(s => s.select);
    const saved = useSavedWorkflows(true);

    const names = (saved.data?.workflows ?? []).filter(w => w.enable_in_simple).map(w => w.name);

    if (!workflow) {
        return null;
    }

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <IconButton onClick={() => select(null)} label={t('simple.bar.change')}>
                <LayoutGrid size={13} aria-hidden />
            </IconButton>
            <span className="max-w-[16rem] truncate text-xs text-fg-strong" title={workflow}>
                {workflow}
            </span>
            <select
                className={SELECT_CLASS}
                value={workflow}
                aria-label={t('simple.bar.quickPick')}
                onChange={e => select(e.target.value)}
            >
                {/* The chosen workflow may have been deleted or unmarked since; keep it listed so
                    the control still shows what the panel is actually running. */}
                {!names.includes(workflow) && <option value={workflow}>{workflow}</option>}
                {names.map(name => (
                    <option key={name} value={name}>
                        {name}
                    </option>
                ))}
            </select>
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
