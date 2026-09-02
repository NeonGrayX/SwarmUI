import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Save, Search, Trash2, X } from 'lucide-react';
import { useSavedWorkflows, type SavedWorkflow } from '@/comfy/actions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { WorkflowCard, WorkflowCardButton } from './WorkflowCard';
import { useTranslation } from '@/i18n';

/** The saved workflow library: pick one to open it in the editor, or manage what is stored. */
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
                                            onOpen={() => props.onOpenWorkflow(workflow.name)}
                                            actions={
                                                props.canEdit && (
                                                    <>
                                                        <WorkflowCardButton
                                                            label={t('comfy.library.replace')}
                                                            onClick={() => props.onReplace(workflow)}
                                                        >
                                                            <Save size={13} aria-hidden />
                                                        </WorkflowCardButton>
                                                        <WorkflowCardButton
                                                            label={t('common.delete')}
                                                            onClick={() => setPendingDelete(workflow.name)}
                                                            destructive
                                                        >
                                                            <Trash2 size={13} aria-hidden />
                                                        </WorkflowCardButton>
                                                    </>
                                                )
                                            }
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
