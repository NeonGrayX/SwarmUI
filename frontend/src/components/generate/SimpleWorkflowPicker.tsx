import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useSavedWorkflows } from '@/comfy/actions';
import { useSimpleWorkflowStore } from '@/comfy/simple';
import { WorkflowCard } from './WorkflowCard';
import { useTranslation } from '@/i18n';

/** What the Simple workspace opens on: the saved workflows their authors marked as fit to be
 *  driven by their controls alone.
 *
 * A workflow earns its place here by being saved with "Show in the Simple tab" ticked, or by
 * carrying a SwarmWorkflowDescription node that says so - the same `enable_in_simple` flag the
 * existing interface's Simple tab filters on (simpletab.js:browserListEntries).
 */
export function SimpleWorkflowPicker() {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const select = useSimpleWorkflowStore(s => s.select);
    const saved = useSavedWorkflows(true);

    const workflows = useMemo(
        () => (saved.data?.workflows ?? []).filter(w => w.enable_in_simple),
        [saved.data]
    );
    const matches = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return workflows;
        }
        return workflows.filter(w => `${w.name}\n${w.description ?? ''}`.toLowerCase().includes(query));
    }, [workflows, search]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-subtle px-4 py-3">
                <div className="min-w-0">
                    <h2 className="text-base font-medium text-fg-strong">{t('simple.picker.title')}</h2>
                    <p className="text-sm text-fg-soft">{t('simple.picker.subtitle')}</p>
                </div>
                <div className="relative ml-auto w-64 max-w-full">
                    <Search
                        size={14}
                        aria-hidden
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft"
                    />
                    <input
                        type="search"
                        value={search}
                        aria-label={t('common.search')}
                        placeholder={t('simple.picker.searchPlaceholder')}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full rounded border border-default bg-surface-sunken py-1.5 pl-7 pr-2 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {saved.isPending ? (
                    <p className="text-sm text-fg-soft">{t('common.loading')}</p>
                ) : saved.isError ? (
                    <p className="text-sm" style={{ color: 'var(--backend-errored)' }}>
                        {saved.error instanceof Error ? saved.error.message : t('simple.loadFailed')}
                    </p>
                ) : matches.length === 0 ? (
                    <div className="py-12 text-center text-sm text-fg-soft">
                        <p>{workflows.length === 0 ? t('simple.picker.empty') : t('simple.picker.noMatches')}</p>
                        {workflows.length === 0 && (
                            <p className="mt-1 text-xs">{t('simple.picker.emptyHint')}</p>
                        )}
                    </div>
                ) : (
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                        {matches.map(workflow => (
                            <WorkflowCard
                                key={workflow.name}
                                workflow={workflow}
                                onOpen={() => select(workflow.name)}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
