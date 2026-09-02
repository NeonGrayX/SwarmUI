import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useCurrentStatus, useSession, useT2IParams } from '@/api/hooks';
import { useComfyWorkflowStore } from '@/comfy/store';
import { EDITOR_OWNED_PARAMS, useEditorStore } from '@/editor/store';
import { useParamSchema } from '@/params/schema';
import { computeVisibility, type FilterMode } from '@/params/visibility';
import { useParamStore } from '@/params/store';
import { ParamField, ParamGroup } from './ParamGroup';
import { useTranslation } from '@/i18n';

const MODES: { id: FilterMode; labelKey: string }[] = [
    { id: 'basic', labelKey: 'params.filter.basic' },
    { id: 'modified', labelKey: 'params.filter.modified' },
    { id: 'advanced', labelKey: 'params.filter.advanced' }
];

/** The generation parameter panel: search, filter chips, then the group tree. */
export function ParamForm() {
    const { t } = useTranslation();
    const session = useSession();
    const params = useT2IParams(session.isSuccess);
    const status = useCurrentStatus(session.isSuccess);
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState<FilterMode>('basic');

    const values = useParamStore(s => s.values);
    const toggles = useParamStore(s => s.toggles);
    const groupToggles = useParamStore(s => s.groupToggles);
    const resetAll = useParamStore(s => s.resetAll);

    const schema = useParamSchema();
    // The image editor supplies these itself while it is open, so the panel must not also offer
    // them - two controls for one value, one of which silently loses.
    const editorOpen = useEditorStore(s => s.open);
    const suppressed = editorOpen ? EDITOR_OWNED_PARAMS : undefined;

    const visibility = useMemo(() => {
        if (!schema) {
            return null;
        }
        return computeVisibility({
            schema,
            values,
            toggles,
            groupToggles,
            supportedFeatures: status.data?.supported_features ?? [],
            search,
            mode,
            suppressed
        });
    }, [schema, values, toggles, groupToggles, status.data?.supported_features, search, mode, suppressed]);

    if (params.isPending) {
        return <p className="p-4 text-sm text-fg-soft">{t('params.loading')}</p>;
    }
    if (params.isError) {
        return (
            <p className="p-4 text-sm" style={{ color: 'var(--backend-errored)' }}>
                {params.error instanceof Error ? params.error.message : t('params.loadFailed')}
            </p>
        );
    }
    if (!schema || !visibility) {
        return null;
    }

    const modifiedCount = visibility.altered.size;
    const visibleUngrouped = schema.ungrouped.filter(p => visibility.visible.has(p.id));
    const searching = search.trim().length > 0;

    return (
        // The panel is narrow, so it overrides the default label column width; the wide settings
        // screens keep the roomier default from tokens.css.
        <div className="flex flex-col h-full min-h-0" style={{ ['--sw-field-label-width' as string]: '6.5rem' }}>
            <ComfyWorkflowNotice />
            <div className="shrink-0 p-2 border-b border-subtle space-y-2">
                <div className="relative">
                    <Search
                        size={14}
                        aria-hidden
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-soft pointer-events-none"
                    />
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('params.filterPlaceholder')}
                        aria-label={t('params.filterLabel')}
                        className="w-full rounded border border-default bg-surface-sunken pl-7 pr-7 py-1.5 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                    />
                    {searching && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            aria-label={t('common.clearFilter')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                        >
                            <X size={13} aria-hidden />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    {MODES.map(entry => {
                        const active = mode === entry.id;
                        const count =
                            entry.id === 'modified'
                                ? modifiedCount
                                : entry.id === 'advanced'
                                  ? visibility.advancedHiddenCount
                                  : null;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => setMode(entry.id)}
                                aria-pressed={active}
                                className={[
                                    'rounded-full border px-2 py-0.5 text-xs transition-colors',
                                    active
                                        ? 'border-transparent bg-[var(--emphasis)] text-[var(--sw-accent-fg)]'
                                        : 'border-default text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]'
                                ].join(' ')}
                            >
                                {t(entry.labelKey)}
                                {count !== null && count > 0 && (
                                    <span className="ml-1 opacity-70">{count}</span>
                                )}
                            </button>
                        );
                    })}
                    <div className="flex-1" />
                    {modifiedCount > 0 && (
                        <button
                            type="button"
                            onClick={resetAll}
                            className="rounded px-1.5 py-0.5 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                        >
                            {t('params.resetAll')}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {visibleUngrouped.map(param => (
                    <ParamField key={param.id} param={param} visibility={visibility} />
                ))}
                {schema.tree.map(node => (
                    <ParamGroup
                        key={node.group.id}
                        node={node}
                        visibility={visibility}
                        forceOpen={searching}
                    />
                ))}
                {visibility.visible.size === 0 && (
                    <p className="px-2 py-6 text-center text-sm text-fg-soft">
                        {searching
                            ? t('params.noMatches', { search: search.trim() })
                            : t('params.noneToShow')}
                    </p>
                )}
            </div>

            <div className="shrink-0 border-t border-subtle px-3 py-1.5 text-xs text-fg-soft">
                {t('params.shownCount', { shown: visibility.visible.size, total: schema.params.length })}
                {modifiedCount > 0 && ` · ${t('params.changedCount', { count: modifiedCount })}`}
            </div>
        </div>
    );
}

/** Says so when the parameters below are a Comfy workflow's rather than Swarm's own, and offers
 *  the way back. Without it the panel would silently be a different set of controls than the one
 *  the user configured.
 *
 *  The Simple workspace is the exception: a workflow is the whole point there, its own bar names
 *  the one in use, and taking it back out from here would leave that bar describing a panel that
 *  no longer matches it. */
function ComfyWorkflowNotice() {
    const { t } = useTranslation();
    const active = useComfyWorkflowStore(s => s.active);
    const name = useComfyWorkflowStore(s => s.name);
    const source = useComfyWorkflowStore(s => s.source);
    const clear = useComfyWorkflowStore(s => s.clear);
    if (!active || source === 'simple') {
        return null;
    }
    return (
        <div
            className="flex shrink-0 items-start gap-2 border-b border-subtle px-2 py-1.5 text-xs"
            style={{ background: 'var(--sw-chip-bg)' }}
        >
            <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg-strong">
                    {name ? t('comfy.active.named', { name }) : t('comfy.active.title')}
                </p>
                <p className="text-fg-soft">{t('comfy.active.body')}</p>
            </div>
            <button
                type="button"
                onClick={clear}
                className="shrink-0 rounded border border-default px-2 py-0.5 text-xs text-fg hover:bg-[var(--sw-hover)]"
            >
                {t('comfy.active.remove')}
            </button>
        </div>
    );
}
