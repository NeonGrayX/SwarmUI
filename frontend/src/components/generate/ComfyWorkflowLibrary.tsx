import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Save, Search, Trash2, X } from 'lucide-react';
import { useSavedWorkflows, type SavedWorkflow } from '@/comfy/actions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTranslation } from '@/i18n';

/** The saved workflow library: pick one to open it in the editor, or manage what is stored.
 *
 * Workflow names carry their folder as a path prefix ('Examples/Basic'), which is shown as a
 * subtitle rather than as a folder tree - the list is short enough that search beats navigation.
 */
export function ComfyWorkflowLibrary(props: {
    open: boolean;
    canEdit: boolean;
    onClose: () => void;
    onOpenWorkflow: (name: string) => void;
    onReplace: (workflow: SavedWorkflow) => void;
    onDelete: (name: string) => Promise<void>;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const saved = useSavedWorkflows(props.open);

    const workflows = saved.data?.workflows ?? [];
    const matches = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return workflows;
        }
        return workflows.filter(w => `${w.name}\n${w.description ?? ''}`.toLowerCase().includes(query));
    }, [workflows, search]);

    return (
        <>
            <Dialog.Root open={props.open} onOpenChange={open => !open && props.onClose()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(38rem,85vh)] w-[min(52rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-default bg-surface-raised shadow-2xl">
                        <div className="flex shrink-0 items-center gap-3 border-b border-subtle px-4 py-3">
                            <Dialog.Title className="text-base font-medium text-fg-strong">
                                {t('comfy.library.title')}
                            </Dialog.Title>
                            <div className="relative ml-auto w-64 max-w-[50%]">
                                <Search
                                    size={14}
                                    aria-hidden
                                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                                />
                                <input
                                    type="search"
                                    value={search}
                                    aria-label={t('common.search')}
                                    placeholder={t('comfy.library.searchPlaceholder')}
                                    onChange={e => setSearch(e.target.value)}
                                    className="w-full rounded border border-default bg-surface-sunken py-1.5 pl-7 pr-2 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                                />
                            </div>
                            <Dialog.Close asChild>
                                <button
                                    type="button"
                                    aria-label={t('common.close')}
                                    className="rounded p-1 text-fg-soft hover:bg-[var(--sw-hover)] hover:text-fg"
                                >
                                    <X size={16} aria-hidden />
                                </button>
                            </Dialog.Close>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            {saved.isPending ? (
                                <p className="text-sm text-fg-soft">{t('common.loading')}</p>
                            ) : matches.length === 0 ? (
                                <div className="py-12 text-center text-sm text-fg-soft">
                                    <p>{workflows.length === 0 ? t('comfy.library.empty') : t('comfy.library.noMatches')}</p>
                                    {workflows.length === 0 && (
                                        <p className="mt-1 text-xs">{t('comfy.library.emptyHint')}</p>
                                    )}
                                </div>
                            ) : (
                                <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                                    {matches.map(workflow => (
                                        <WorkflowCard
                                            key={workflow.name}
                                            workflow={workflow}
                                            canEdit={props.canEdit}
                                            onOpen={() => props.onOpenWorkflow(workflow.name)}
                                            onReplace={() => props.onReplace(workflow)}
                                            onDelete={() => setPendingDelete(workflow.name)}
                                        />
                                    ))}
                                </ul>
                            )}
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t('comfy.library.deleteTitle')}
                body={t('comfy.library.deleteBody', { name: pendingDelete ?? '' })}
                confirmLabel={t('common.delete')}
                destructive
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => {
                    const name = pendingDelete;
                    setPendingDelete(null);
                    if (name) {
                        void props.onDelete(name);
                    }
                }}
            />
        </>
    );
}

function WorkflowCard(props: {
    workflow: SavedWorkflow;
    canEdit: boolean;
    onOpen: () => void;
    onReplace: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const { name, description, image } = props.workflow;
    const slash = name.lastIndexOf('/');
    const folder = slash > 0 ? name.substring(0, slash) : null;
    const label = slash > 0 ? name.substring(slash + 1) : name;

    return (
        <li className="group relative overflow-hidden rounded-lg border border-subtle bg-surface">
            <button type="button" onClick={props.onOpen} className="block w-full text-left" title={description || name}>
                <img
                    src={image}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full bg-surface-sunken object-cover"
                />
                <span className="block px-2 py-1.5">
                    <span className="block truncate text-sm text-fg-strong">{label}</span>
                    {folder && <span className="block truncate text-[11px] text-fg-soft">{folder}</span>}
                    {description && <span className="mt-0.5 block line-clamp-2 text-xs text-fg-soft">{description}</span>}
                </span>
            </button>
            {props.canEdit && (
                // Kept out of the way until the card is reached for: opening is the common action,
                // and a delete button under the pointer is a bad default.
                <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton label={t('comfy.library.replace')} onClick={props.onReplace}>
                        <Save size={13} aria-hidden />
                    </IconButton>
                    <IconButton label={t('common.delete')} onClick={props.onDelete} destructive>
                        <Trash2 size={13} aria-hidden />
                    </IconButton>
                </div>
            )}
        </li>
    );
}

function IconButton(props: {
    label: string;
    destructive?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            title={props.label}
            className="rounded p-1.5 backdrop-blur"
            style={{
                background: props.destructive ? 'var(--sw-danger-surface)' : 'var(--sw-surface-raised)',
                color: props.destructive ? 'var(--backend-errored)' : 'var(--text)'
            }}
        >
            {props.children}
        </button>
    );
}
