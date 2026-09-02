import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ChevronDown, Star } from 'lucide-react';
import {
    PickerCard,
    PickerChip,
    PickerGroup,
    PickerRow,
    PickerSearch,
    PickerStar,
    PickerThumb,
    PickerViewToggle
} from '@/components/form/PickerParts';
import { useSavedWorkflows, type SavedWorkflow } from '@/comfy/actions';
import { useSimpleWorkflowStore, type SimpleWorkflowSession } from '@/comfy/simple';
import { useWorkflowStars } from '@/comfy/stars';
import type { ViewMode } from '@/library/types';
import { useTranslation } from '@/i18n';

/** The Simple workspace's own tools, in the strip beside the mode switch: which workflow is
 *  driving the panel, and how to reach for another.
 *
 * Sharing that strip is what lets the workspace below stay exactly the standard one - parameters,
 * canvas and batch - with the workflow's controls in place of Swarm's own. Choosing among the
 * workflows works the way choosing a model does, out of the same dropdown parts, so the two are
 * one habit rather than two.
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

/** How the picker was left last time: grid or list, and whether it was down to starred workflows
 *  only. Remembered the way the model picker remembers its own. */
interface WorkflowPickerPrefs {
    view: ViewMode;
    starredOnly: boolean;
    setView: (view: ViewMode) => void;
    setStarredOnly: (on: boolean) => void;
}

const useWorkflowPickerPrefs = create<WorkflowPickerPrefs>()(
    persist(
        set => ({
            view: 'grid',
            starredOnly: false,
            setView: view => set({ view }),
            setStarredOnly: starredOnly => set({ starredOnly })
        }),
        { name: 'swarm-ui-simple-workflow-picker' }
    )
);

function WorkflowDropdown() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const workflow = useSimpleWorkflowStore(s => s.workflow);
    const select = useSimpleWorkflowStore(s => s.select);
    const saved = useSavedWorkflows(true);

    const workflows = useMemo(
        () => (saved.data?.workflows ?? []).filter(w => w.enable_in_simple),
        [saved.data]
    );
    const option = workflows.find(w => w.name === workflow);

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={t('simple.bar.quickPick')}
                    title={workflow ?? undefined}
                    className="flex w-56 max-w-full items-center gap-1.5 rounded border border-default bg-surface-sunken py-0.5 pl-1 pr-1.5 text-left text-xs text-fg outline-none hover:border-[var(--emphasis)] focus:border-[var(--emphasis)]"
                >
                    <PickerThumb preview={option?.image} size="xs" />
                    <span
                        className={['min-w-0 flex-1 truncate', workflow ? 'text-fg-strong' : 'text-fg-soft'].join(' ')}
                    >
                        {workflow ? leafOf(workflow) : t('modelPicker.noneSelected')}
                    </span>
                    <ChevronDown size={13} aria-hidden className="shrink-0 text-fg-soft" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                    className="z-50 w-[min(28rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-default bg-surface-raised shadow-2xl"
                >
                    <WorkflowOptionList
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
                        onPick={name => {
                            select(name);
                            setOpen(false);
                        }}
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** The searchable body of the dropdown: the same cards, rows, search and scrolling the model
 *  pickers use, over the workflows their authors marked as fit to be driven by their own controls.
 *
 * A workflow earns its place here by being saved with "Show in the Simple tab" ticked, or by
 * carrying a SwarmWorkflowDescription node that says so - the same `enable_in_simple` flag the
 * existing interface's Simple tab filters on (simpletab.js:browserListEntries).
 */
function WorkflowOptionList(props: {
    workflows: SavedWorkflow[];
    loading: boolean;
    error: string | null;
    current: string | null;
    onPick: (name: string) => void;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const prefs = useWorkflowPickerPrefs();
    const stars = useWorkflowStars();

    // Starred first, then the server's name ordering - the same rule the model pickers follow, so
    // the workflows worth reaching for are the ones already on screen when the list opens.
    const matches = useMemo(() => {
        const query = search.trim().toLowerCase();
        const shown = props.workflows.filter(w => {
            if (prefs.starredOnly && !stars.isStarred(w.name)) {
                return false;
            }
            return !query || `${w.name}\n${w.description ?? ''}`.toLowerCase().includes(query);
        });
        return shown.sort(
            (a, b) => Number(stars.isStarred(b.name)) - Number(stars.isStarred(a.name))
        );
    }, [props.workflows, search, prefs.starredOnly, stars]);

    return (
        <Command shouldFilter={false} loop label={t('simple.bar.quickPick')}>
            <div className="border-b border-subtle p-2">
                <PickerSearch
                    value={search}
                    onChange={setSearch}
                    placeholder={t('simple.picker.searchPlaceholder')}
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
                ) : props.error ? (
                    <p className="px-2 py-6 text-center text-sm" style={{ color: 'var(--backend-errored)' }}>
                        {props.error}
                    </p>
                ) : (
                    matches.length === 0 && (
                        <div className="px-2 py-6 text-center text-sm text-fg-soft">
                            <p>
                                {props.workflows.length === 0
                                    ? t('simple.picker.empty')
                                    : prefs.starredOnly && stars.count === 0
                                      ? t('simple.picker.noneStarred')
                                      : t('simple.picker.noMatches')}
                            </p>
                            {props.workflows.length === 0 && (
                                <p className="mt-1 text-xs">{t('simple.picker.emptyHint')}</p>
                            )}
                        </div>
                    )
                )}

                <PickerGroup view={prefs.view}>
                    {matches.map(workflow => {
                        const starred = stars.isStarred(workflow.name);
                        const shared = {
                            value: workflow.name,
                            onPick: () => props.onPick(workflow.name),
                            tooltip: workflow.description || workflow.name,
                            picked: workflow.name === props.current,
                            preview: workflow.image,
                            title: leafOf(workflow.name),
                            subtitle: folderOf(workflow.name)
                        };
                        return prefs.view === 'grid' ? (
                            <PickerCard
                                key={workflow.name}
                                {...shared}
                                actions={
                                    <PickerStar
                                        starred={starred}
                                        onStar={() => stars.toggle(workflow.name)}
                                        overlay
                                    />
                                }
                            />
                        ) : (
                            <PickerRow
                                key={workflow.name}
                                {...shared}
                                actions={
                                    <PickerStar starred={starred} onStar={() => stars.toggle(workflow.name)} />
                                }
                            />
                        );
                    })}
                </PickerGroup>
            </Command.List>

            <div className="flex items-center gap-2 border-t border-subtle px-3 py-1.5 text-xs text-fg-soft">
                <span>
                    {t('modelPicker.countOf', { shown: matches.length, total: props.workflows.length })}
                </span>
            </div>
        </Command>
    );
}

/** Workflow names carry their folder as a path prefix ('Examples/Basic'), and it is the leaf that
 *  identifies one at a glance - the folder goes underneath, as a model's does. */
function leafOf(name: string): string {
    const slash = name.lastIndexOf('/');
    return slash > 0 ? name.substring(slash + 1) : name;
}

function folderOf(name: string): string | null {
    const slash = name.lastIndexOf('/');
    return slash > 0 ? name.substring(0, slash) : null;
}
