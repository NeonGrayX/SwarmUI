import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { ChevronDown, Star } from 'lucide-react';
import {
    PickerCard,
    PickerChip,
    PickerGroup,
    PickerRow,
    PickerSearch,
    PickerStar,
    PickerThumb,
    PickerViewToggle,
    usePickerPrefs
} from '@/components/form/PickerParts';
import type { SavedWorkflow } from '@/comfy/actions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    insideContextMenu,
    useContextMenu,
    type ContextMenuHandle,
    type MenuAction
} from '@/components/ui/ContextMenu';
import { useWorkflowStars } from '@/library/stars';
import { useTranslation } from '@/i18n';

/** Choosing among the saved workflows, out of the same parts the model pickers are built from:
 *  search, stars, thumbnails, grid or list.
 *
 * Two bars reach for a saved workflow - the Simple workspace picks which one drives the panel, and
 * the Comfy bar's Quick load reopens one as a graph - and this is both of them, so the two work the
 * same way and share the stars a user has put on their workflows.
 *
 * What differs is what a pick means. The Simple workspace holds a selection and shows it on the
 * trigger; Quick load performs an action and goes back to reading "Quick load", which is what
 * `current` being undefined says.
 *
 * Right-clicking an entry offers what can be done to the workflow itself rather than with it -
 * starring it, and deleting it where the bar above allows that - so tidying the list up is done
 * where the list is read, without a trip to the Library.
 */
export function WorkflowPicker(props: {
    /** Names the control, and labels the list for screen readers. */
    label: string;
    workflows: SavedWorkflow[];
    loading: boolean;
    error: string | null;
    /** The chosen workflow, for pickers that hold a selection. Undefined where a pick is an action
     *  rather than a state. */
    current?: string | null;
    disabled?: boolean;
    /** localStorage key this picker remembers its view and star filter under. */
    prefsKey: string;
    /** Shown when there are no workflows to offer at all - which is a different thing from a
     *  search matching none, and usually has something to suggest. */
    emptyText: string;
    emptyHint?: string;
    onPick: (name: string) => void;
    /** Deletes a workflow, for the right-click menu. Left out where the user may not: the menu
     *  then offers only what they can do. Confirmation happens here, before this is called. */
    onDelete?: (name: string) => void;
    /** Width of the trigger button. */
    className?: string;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const contextMenu = useContextMenu();
    const selecting = props.current !== undefined;
    const option = props.workflows.find(w => w.name === props.current);

    return (
        <>
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        disabled={props.disabled}
                        aria-label={props.label}
                        title={props.current ?? undefined}
                        className={[
                            props.className ?? 'w-40',
                            'flex max-w-full items-center gap-1.5 rounded border border-default bg-surface-sunken py-0.5 pl-1 pr-1.5 text-left text-xs text-fg outline-none hover:border-[var(--emphasis)] focus:border-[var(--emphasis)] disabled:opacity-50'
                        ].join(' ')}
                    >
                        {selecting && <PickerThumb preview={option?.image} size="xs" />}
                        <span
                            className={[
                                'min-w-0 flex-1 truncate',
                                selecting && props.current ? 'text-fg-strong' : 'text-fg-soft',
                                selecting ? '' : 'pl-0.5'
                            ].join(' ')}
                        >
                            {selecting
                                ? props.current
                                    ? leafOf(props.current)
                                    : t('modelPicker.noneSelected')
                                : props.label}
                        </span>
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
                        <WorkflowOptionList
                            {...props}
                            menu={contextMenu}
                            onPick={name => {
                                props.onPick(name);
                                setOpen(false);
                            }}
                            onDelete={
                                props.onDelete &&
                                (name => {
                                    // The confirmation is a modal dialog, and a list left open behind
                                    // it is a list the user cannot get back to until they answer.
                                    setOpen(false);
                                    setPendingDelete(name);
                                })
                            }
                        />
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>

            {contextMenu.menu}

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
                        props.onDelete?.(name);
                    }
                }}
                onCancel={() => setPendingDelete(null)}
            />
        </>
    );
}

/** The searchable body of the dropdown: the same cards, rows, search and scrolling the model
 *  pickers use, over whichever workflows the bar above handed down. */
function WorkflowOptionList(props: {
    label: string;
    workflows: SavedWorkflow[];
    loading: boolean;
    error: string | null;
    current?: string | null;
    prefsKey: string;
    emptyText: string;
    emptyHint?: string;
    onPick: (name: string) => void;
    onDelete?: (name: string) => void;
    menu: ContextMenuHandle;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const prefs = usePickerPrefs(props.prefsKey);
    const stars = useWorkflowStars();
    const onDelete = props.onDelete;

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
        <Command shouldFilter={false} loop label={props.label}>
            <div className="border-b border-subtle p-2">
                <PickerSearch
                    value={search}
                    onChange={setSearch}
                    placeholder={t('workflows.searchPlaceholder')}
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
                                    ? props.emptyText
                                    : prefs.starredOnly && stars.count === 0
                                      ? t('workflows.noneStarred')
                                      : t('workflows.noMatches')}
                            </p>
                            {props.workflows.length === 0 && props.emptyHint && (
                                <p className="mt-1 text-xs">{props.emptyHint}</p>
                            )}
                        </div>
                    )
                )}

                <PickerGroup view={prefs.view}>
                    {matches.map(workflow => {
                        const starred = stars.isStarred(workflow.name);
                        const menuActions: MenuAction[] = [
                            {
                                label: starred ? t('common.unstar') : t('common.star'),
                                onSelect: () => stars.toggle(workflow.name)
                            }
                        ];
                        if (onDelete) {
                            menuActions.push({
                                label: t('common.delete'),
                                destructive: true,
                                separated: true,
                                onSelect: () => onDelete(workflow.name)
                            });
                        }
                        const shared = {
                            value: workflow.name,
                            onPick: () => props.onPick(workflow.name),
                            tooltip: workflow.description || workflow.name,
                            picked: workflow.name === props.current,
                            preview: workflow.image,
                            title: leafOf(workflow.name),
                            subtitle: folderOf(workflow.name),
                            onContextMenu: (event: React.MouseEvent) => props.menu.open(event, menuActions),
                            longPress: props.menu.touch(menuActions)
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
