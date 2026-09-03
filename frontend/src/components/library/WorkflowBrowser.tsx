import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ImageOff, Star, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { usePermission } from '@/api/permissions';
import { comfyKeys, useSavedWorkflows, type SavedWorkflow } from '@/comfy/actions';
import { useWorkspaceHandoffStore } from '@/generate/handoff';
import { useWorkflowStars } from '@/library/stars';
import type { ViewMode } from '@/library/types';
import { BrowserToolbar, EmptyState, StarButton } from './BrowserChrome';
import { WorkflowDetailSheet } from './WorkflowDetailSheet';
import { SelectionBar, SelectionButton, SelectionCheckbox, useSelection } from './Selection';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useContextMenu, type LongPressHandlers, type MenuAction } from '../ui/ContextMenu';
import { useTranslation } from '@/i18n';

/** The saved Comfy workflows, as a Library screen of their own.
 *
 * The Comfy editor has a library dialog too, but that one is about the graph behind a workflow -
 * reopening it, saving over it. This screen is about the workflow as a thing to keep: which ones
 * are worth starring, and which have outlived their use. Opening one takes it wherever it is meant
 * to be driven: the Simple workspace for a workflow whose author declared its own controls, and
 * the Comfy editor for one that has none, where the graph itself is what there is to work with.
 *
 * Workflows are shared server-wide rather than owned per user, so deleting one takes it away from
 * everybody - starring, which is the user's own, is the half of this screen that is not.
 */
export function WorkflowBrowser() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [view, setView] = useState<ViewMode>('grid');
    const [reverse, setReverse] = useState(false);
    const [starredOnly, setStarredOnly] = useState(false);
    // By name rather than by entry, so a refreshed list feeds the sheet its current description
    // and preview rather than the copy that happened to be on screen when it was clicked.
    const [selected, setSelected] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    const canDelete = usePermission('comfy_edit_workflows');
    const saved = useSavedWorkflows(true);
    const stars = useWorkflowStars();
    const contextMenu = useContextMenu();
    const handOver = useWorkspaceHandoffStore(s => s.openWorkflow);

    const workflows = useMemo(() => saved.data?.workflows ?? [], [saved.data]);

    // ComfyListWorkflows answers in name order and carries no dates, so name is the only ordering
    // there is to offer - starred first, as everywhere else, and reversible.
    const ordered = useMemo(() => {
        const query = search.trim().toLowerCase();
        const shown = workflows.filter(workflow => {
            if (starredOnly && !stars.isStarred(workflow.name)) {
                return false;
            }
            return (
                !query ||
                `${workflow.name}\n${workflow.description ?? ''}`.toLowerCase().includes(query)
            );
        });
        if (reverse) {
            shown.reverse();
        }
        return shown.sort(
            (a, b) => Number(stars.isStarred(b.name)) - Number(stars.isStarred(a.name))
        );
    }, [workflows, search, starredOnly, reverse, stars]);

    const ids = useMemo(() => ordered.map(workflow => workflow.name), [ordered]);
    const selection = useSelection(ids);
    const detail = workflows.find(workflow => workflow.name === selected) ?? null;

    /** Hands a workflow to the workspace it belongs in and goes there.
     *
     *  Every workflow runs in the Simple workspace - the flag gates nothing in the engine - but one
     *  without SwarmInput nodes has no controls of its own to show there, only its raw node inputs.
     *  So an unmarked workflow goes to the editor instead, where the graph is the point. */
    function open(workflow: SavedWorkflow): void {
        handOver(workflow.name, workflow.enable_in_simple ? 'simple' : 'comfy');
        navigate({ to: '/generate' });
    }

    async function deleteWorkflow(name: string): Promise<void> {
        try {
            await api.post('ComfyDeleteWorkflow', { name });
            // Only once it is really gone: a delete the server refused leaves the sheet up, with
            // the reason for the refusal in the flash beside it.
            if (name === selected) {
                setSelected(null);
            }
            await queryClient.invalidateQueries({ queryKey: comfyKeys.workflows });
        }
        catch (error: unknown) {
            setFlash(error instanceof Error ? error.message : String(error));
        }
    }

    /** Deletes every selected workflow. One request each - the API has no batch form. */
    async function deleteSelected(): Promise<void> {
        const targets = selection.ids;
        selection.clear();
        for (const name of targets) {
            await deleteWorkflow(name);
        }
    }

    /** Everything one workflow can do, for its right-click menu. */
    function actionsFor(workflow: SavedWorkflow): MenuAction[] {
        const actions: MenuAction[] = [
            { label: t('modelBrowser.action.details'), onSelect: () => setSelected(workflow.name) },
            {
                label: workflow.enable_in_simple ? t('workflows.open') : t('workflows.openInEditor'),
                onSelect: () => open(workflow)
            },
            {
                label: stars.isStarred(workflow.name) ? t('common.unstar') : t('common.star'),
                onSelect: () => stars.toggle(workflow.name)
            }
        ];
        if (canDelete) {
            actions.push({
                label: t('common.delete'),
                destructive: true,
                separated: true,
                onSelect: () => setPendingDelete(workflow.name)
            });
        }
        return actions;
    }

    return (
        <div className="relative flex h-full min-h-0">
            <div className="flex min-w-0 flex-1 flex-col">
                <BrowserToolbar
                    search={search}
                    onSearch={setSearch}
                    view={view}
                    onView={setView}
                    reverse={reverse}
                    onReverse={setReverse}
                    count={ordered.length}
                    total={workflows.length}
                >
                    <button
                        type="button"
                        onClick={() => setStarredOnly(!starredOnly)}
                        aria-pressed={starredOnly}
                        title={t('browser.starredOnlyHint')}
                        className={[
                            'flex items-center gap-1 rounded border px-2 py-1 text-xs',
                            starredOnly
                                ? 'border-transparent bg-[var(--emphasis)] text-[var(--sw-accent-fg)]'
                                : 'border-default text-fg hover:bg-[var(--sw-hover)]'
                        ].join(' ')}
                    >
                        <Star size={13} aria-hidden fill={starredOnly ? 'currentColor' : 'none'} />
                        {t('browser.starredOnly')}
                    </button>
                </BrowserToolbar>

                {selection.count > 0 && (
                    <SelectionBar
                        count={selection.count}
                        total={ordered.length}
                        onSelectAll={selection.selectAll}
                        onClear={selection.clear}
                    >
                        {canDelete && (
                            <SelectionButton
                                label={t('common.delete')}
                                destructive
                                onClick={() => setPendingBulkDelete(true)}
                            >
                                <Trash2 size={13} aria-hidden />
                            </SelectionButton>
                        )}
                    </SelectionBar>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {saved.isPending ? (
                        <EmptyState title={t('workflows.loading')} />
                    ) : saved.isError ? (
                        <EmptyState
                            title={t('workflows.loadFailed')}
                            hint={saved.error instanceof Error ? saved.error.message : undefined}
                        />
                    ) : ordered.length === 0 ? (
                        <EmptyState
                            title={
                                workflows.length === 0
                                    ? t('workflows.none')
                                    : search
                                      ? t('workflows.noSearchMatches', { search: search.trim() })
                                      : t('workflows.noneStarred')
                            }
                            hint={workflows.length === 0 ? t('workflows.noneHint') : undefined}
                        />
                    ) : view === 'grid' ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                            {ordered.map(workflow => (
                                <Card
                                    key={workflow.name}
                                    workflow={workflow}
                                    starred={stars.isStarred(workflow.name)}
                                    checked={selection.isSelected(workflow.name)}
                                    onCheck={() => selection.toggle(workflow.name)}
                                    onStar={() => stars.toggle(workflow.name)}
                                    onOpen={event =>
                                        selection.click(event, workflow.name, () => setSelected(workflow.name))
                                    }
                                    onMenu={event => contextMenu.open(event, actionsFor(workflow))}
                                    longPress={contextMenu.touch(() => actionsFor(workflow))}
                                />
                            ))}
                        </div>
                    ) : (
                        <ul className="divide-y divide-[var(--light-border)]">
                            {ordered.map(workflow => (
                                <Row
                                    key={workflow.name}
                                    workflow={workflow}
                                    starred={stars.isStarred(workflow.name)}
                                    checked={selection.isSelected(workflow.name)}
                                    onCheck={() => selection.toggle(workflow.name)}
                                    onStar={() => stars.toggle(workflow.name)}
                                    onOpen={event =>
                                        selection.click(event, workflow.name, () => setSelected(workflow.name))
                                    }
                                    onMenu={event => contextMenu.open(event, actionsFor(workflow))}
                                    longPress={contextMenu.touch(() => actionsFor(workflow))}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {detail && (
                <WorkflowDetailSheet
                    workflow={detail}
                    starred={stars.isStarred(detail.name)}
                    canDelete={canDelete}
                    onOpen={() => open(detail)}
                    onDelete={() => setPendingDelete(detail.name)}
                    onStar={() => stars.toggle(detail.name)}
                    onClose={() => setSelected(null)}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t('comfy.library.deleteTitle')}
                body={t('comfy.library.deleteBody', { name: pendingDelete ?? '' })}
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    const name = pendingDelete;
                    setPendingDelete(null);
                    if (name) {
                        void deleteWorkflow(name);
                    }
                }}
                onCancel={() => setPendingDelete(null)}
            />

            <ConfirmDialog
                open={pendingBulkDelete}
                title={t('workflows.bulkDeleteTitle', { count: selection.count })}
                body={t('workflows.bulkDeleteBody', { count: selection.count })}
                confirmLabel={t('common.delete')}
                destructive
                onConfirm={() => {
                    setPendingBulkDelete(false);
                    void deleteSelected();
                }}
                onCancel={() => setPendingBulkDelete(false)}
            />

            {flash && (
                <p
                    role="status"
                    className="absolute bottom-3 right-3 z-40 max-w-96 rounded border border-default bg-surface px-2 py-1 text-xs shadow-lg"
                    style={{ color: 'var(--backend-errored)' }}
                >
                    {flash}
                </p>
            )}

            {contextMenu.menu}
        </div>
    );
}

interface EntryProps {
    workflow: SavedWorkflow;
    starred: boolean;
    checked: boolean;
    onCheck: () => void;
    onStar: () => void;
    onOpen: (event: React.MouseEvent) => void;
    onMenu: (event: React.MouseEvent) => void;
    longPress: LongPressHandlers;
}

/** Workflow names carry their folder as a path prefix ('Examples/Basic'); the leaf is what
 *  identifies one at a glance, with the folder under it. */
function leafOf(name: string): string {
    const slash = name.lastIndexOf('/');
    return slash > 0 ? name.substring(slash + 1) : name;
}

function folderOf(name: string): string | null {
    const slash = name.lastIndexOf('/');
    return slash > 0 ? name.substring(0, slash) : null;
}

function Card(props: EntryProps) {
    const { t } = useTranslation();
    const { workflow } = props;
    const folder = folderOf(workflow.name);

    return (
        <div
            className={[
                'group relative overflow-hidden rounded-lg border bg-surface',
                props.checked ? 'border-[var(--emphasis)]' : 'border-default'
            ].join(' ')}
            onContextMenu={props.onMenu}
            {...props.longPress}
        >
            <button
                type="button"
                onClick={props.onOpen}
                className="block w-full text-left"
                title={`${workflow.description || workflow.name}\n${t('browser.rightClickForActions')}`}
            >
                <div className="flex aspect-square items-center justify-center bg-surface-sunken">
                    {workflow.image ? (
                        <img
                            src={workflow.image}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <ImageOff size={24} className="text-fg-soft opacity-40" aria-hidden />
                    )}
                </div>
                <div className="p-2">
                    <p className="truncate text-sm text-fg-strong">{leafOf(workflow.name)}</p>
                    {folder && <p className="truncate text-xs text-fg-soft">{folder}</p>}
                    {workflow.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-fg-soft">{workflow.description}</p>
                    )}
                </div>
            </button>

            <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                <SelectionCheckbox
                    overlay
                    checked={props.checked}
                    onToggle={props.onCheck}
                    label={t('browser.selectEntry', { name: workflow.name })}
                />
                {workflow.enable_in_simple && <SimpleBadge />}
            </div>

            <div className="absolute right-1.5 top-1.5 flex gap-1">
                <StarButton starred={props.starred} variant="overlay" onClick={props.onStar} />
            </div>
        </div>
    );
}

function Row(props: EntryProps) {
    const { t } = useTranslation();
    const { workflow } = props;

    return (
        <li className="group flex items-center gap-3 py-1.5" onContextMenu={props.onMenu} {...props.longPress}>
            <SelectionCheckbox
                checked={props.checked}
                onToggle={props.onCheck}
                label={t('browser.selectEntry', { name: workflow.name })}
            />
            <StarButton starred={props.starred} variant="plain" onClick={props.onStar} />
            <button
                type="button"
                onClick={props.onOpen}
                title={`${workflow.description || workflow.name}\n${t('browser.rightClickForActions')}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
                <span className="size-8 shrink-0 overflow-hidden rounded bg-surface-sunken">
                    {workflow.image && (
                        <img src={workflow.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{workflow.name}</span>
                {workflow.description && (
                    <span className="hidden min-w-0 max-w-64 truncate text-xs text-fg-soft sm:block">
                        {workflow.description}
                    </span>
                )}
                {workflow.enable_in_simple && <SimpleBadge />}
            </button>
        </li>
    );
}

/** Marks a workflow the Simple workspace's own dropdown offers, ie one whose author meant it to be
 *  driven by its controls rather than opened as a graph. */
function SimpleBadge() {
    const { t } = useTranslation();
    return (
        <span
            title={t('workflows.simpleHint')}
            className="shrink-0 rounded px-1 text-[10px]"
            style={{ background: 'var(--sw-chip-bg)', color: 'var(--text)' }}
        >
            {t('workflows.simple')}
        </span>
    );
}
