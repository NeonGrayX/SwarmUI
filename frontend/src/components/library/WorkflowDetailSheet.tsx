import { useMemo } from 'react';
import { ImageOff, Star, Trash2, X } from 'lucide-react';
import { useSavedWorkflow, type SavedWorkflow } from '@/comfy/actions';
import type { ComfyParamDef } from '@/comfy/params';
import { DetailSheet } from '../ui/DetailSheet';
import { useTranslation } from '@/i18n';

/** What the stored graph says about itself, once it has been read back.
 *
 * Both halves are parsed out of the same payload the editor reopens: the API-format prompt gives
 * the node count, and `custom_params` gives the controls the workflow's own SwarmInput nodes
 * declared - the ones the Simple workspace would put on screen for it. */
interface GraphFacts {
    nodes: number;
    params: ComfyParamDef[];
}

function readFacts(prompt: string, customParams: string): GraphFacts | null {
    try {
        const nodes = Object.keys(JSON.parse(prompt) as Record<string, unknown>).length;
        const defs = JSON.parse(customParams) as Record<string, ComfyParamDef>;
        return {
            nodes,
            params: Object.values(defs).sort((a, b) => a.priority - b.priority)
        };
    }
    catch {
        // A workflow saved by an older Swarm, or one hand-edited on disk. The rest of the sheet is
        // still worth showing, so a graph that will not parse just costs its own section.
        return null;
    }
}

/** Side sheet for one saved workflow: its preview and description, plus what the graph behind it
 *  turns out to be - how big it is, and which controls it declares for the Simple workspace. */
export function WorkflowDetailSheet(props: {
    workflow: SavedWorkflow;
    starred: boolean;
    canDelete: boolean;
    onOpen: () => void;
    onDelete: () => void;
    onStar: () => void;
    onClose: () => void;
}) {
    const { t, tDynamic } = useTranslation();
    const { workflow } = props;
    const slash = workflow.name.lastIndexOf('/');
    const leaf = slash > 0 ? workflow.name.substring(slash + 1) : workflow.name;

    const details = useSavedWorkflow(workflow.name);
    const facts = useMemo(
        () => (details.data ? readFacts(details.data.prompt, details.data.custom_params) : null),
        [details.data]
    );

    return (
        <DetailSheet label={t('workflowDetail.title')} onClose={props.onClose}>
            <div className="flex shrink-0 items-start gap-2 border-b border-subtle p-3">
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-medium text-fg-strong" title={workflow.name}>
                        {leaf}
                    </h2>
                    {slash > 0 && (
                        <p className="truncate font-mono text-[11px] text-fg-soft" title={workflow.name}>
                            {workflow.name.substring(0, slash)}
                        </p>
                    )}
                </div>
                <SheetIcon
                    label={props.starred ? t('common.unstar') : t('common.star')}
                    onClick={props.onStar}
                    color={props.starred ? 'var(--star)' : undefined}
                >
                    <Star size={15} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
                </SheetIcon>
                {props.canDelete && (
                    <SheetIcon
                        label={t('common.delete')}
                        onClick={props.onDelete}
                        color="var(--backend-errored)"
                    >
                        <Trash2 size={15} aria-hidden />
                    </SheetIcon>
                )}
                <SheetIcon label={t('common.closeDetails')} onClick={props.onClose}>
                    <X size={15} aria-hidden />
                </SheetIcon>
            </div>

            {/* Worded as the destination rather than as "open", since where a workflow opens is the
                part that is not obvious: only one with controls of its own has anywhere to go but
                the editor. */}
            <div className="shrink-0 border-b border-subtle px-3 py-2">
                <button
                    type="button"
                    onClick={props.onOpen}
                    className="w-full rounded px-3 py-1.5 text-sm"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {workflow.enable_in_simple ? t('workflows.open') : t('workflows.openInEditor')}
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {workflow.image ? (
                    <img
                        src={workflow.image}
                        alt=""
                        className="mb-3 max-h-64 w-full rounded border border-subtle object-cover lg:max-h-none"
                    />
                ) : (
                    <div className="mb-3 flex aspect-square max-h-64 items-center justify-center rounded border border-subtle bg-surface-sunken">
                        <ImageOff size={24} className="text-fg-soft opacity-40" aria-hidden />
                    </div>
                )}

                <p className="whitespace-pre-wrap break-words text-sm text-fg-soft">
                    {workflow.description || t('workflowDetail.noDescription')}
                </p>

                <dl className="mt-3 space-y-1 border-t border-subtle pt-3 text-xs">
                    <Fact
                        label={t('workflowDetail.fact.simple')}
                        value={workflow.enable_in_simple ? t('common.yes') : t('common.no')}
                    />
                    {facts && (
                        <>
                            <Fact
                                label={t('workflowDetail.fact.nodes')}
                                value={t('workflowDetail.nodeCount', { count: facts.nodes })}
                            />
                            <Fact
                                label={t('workflowDetail.fact.controls')}
                                value={t('workflowDetail.controlCount', { count: facts.params.length })}
                            />
                        </>
                    )}
                </dl>

                {details.isPending ? (
                    <p className="mt-3 text-xs text-fg-soft">{t('workflowDetail.loading')}</p>
                ) : details.isError ? (
                    <p className="mt-3 text-xs" style={{ color: 'var(--backend-errored)' }}>
                        {details.error instanceof Error ? details.error.message : t('workflowDetail.loadFailed')}
                    </p>
                ) : facts === null ? (
                    <p className="mt-3 text-xs text-fg-soft">{t('workflowDetail.unreadableGraph')}</p>
                ) : facts.params.length > 0 ? (
                    <section className="mt-3">
                        <h3 className="mb-1 text-xs uppercase tracking-wide text-fg-soft">
                            {t('workflowDetail.controls')}
                        </h3>
                        <dl className="space-y-1 border-t border-subtle pt-1.5 text-xs">
                            {facts.params.map(param => (
                                <div key={param.id}>
                                    <div className="flex gap-2">
                                        <dt className="w-[7rem] shrink-0 truncate text-fg-soft" title={param.name}>
                                            {tDynamic(param.name)}
                                        </dt>
                                        <dd className="min-w-0 flex-1 break-words text-fg">
                                            {param.type}
                                            {param.default !== null && param.default !== undefined && param.default !== ''
                                                ? ` · ${String(param.default)}`
                                                : ''}
                                        </dd>
                                    </div>
                                    {param.description && (
                                        <p className="ml-[7rem] pl-2 text-fg-soft">{tDynamic(param.description)}</p>
                                    )}
                                </div>
                            ))}
                        </dl>
                    </section>
                ) : null}
            </div>
        </DetailSheet>
    );
}

function Fact(props: { label: string; value: string }) {
    return (
        <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-fg-soft">{props.label}</dt>
            <dd className="min-w-0 flex-1 break-words text-fg-soft">{props.value}</dd>
        </div>
    );
}

function SheetIcon(props: {
    label: string;
    onClick: () => void;
    color?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            title={props.label}
            className="shrink-0 rounded p-1 hover:bg-[var(--sw-hover)]"
            style={{ color: props.color ?? 'var(--sw-fg-soft)' }}
        >
            {props.children}
        </button>
    );
}
