import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useT2IParams } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { Field } from '@/components/form/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    runMetadataScan,
    SCAN_DATE_RANGES,
    SCAN_FILTERS,
    SCAN_REPLACES,
    type ScanDateRange,
    type ScanFilter,
    type ScanProgress,
    type ScanReplace
} from '@/tools/metadataScanner';
import { useTranslation } from '@/i18n';

const SELECT =
    'rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)] disabled:opacity-60';

/** The Civitai metadata scan, as legacy's Utilities tab offers it (ModelMetadataScanner). Runs in
 *  this tab, so leaving the page stops it after the lookups already in flight. */
export function MetadataScanner() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    // ForwardMetadataRequest and EditModelMetadata are both gated on this.
    const canEdit = usePermission('edit_model_metadata');
    const params = useT2IParams();
    const [subtype, setSubtype] = useState('all');
    const [dateRange, setDateRange] = useState<ScanDateRange>('all');
    const [filter, setFilter] = useState<ScanFilter>('all');
    const [replace, setReplace] = useState<ScanReplace>('only_missing');
    const [nameFilter, setNameFilter] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [running, setRunning] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [progress, setProgress] = useState<ScanProgress | null>(null);
    const [finished, setFinished] = useState(false);
    const stopRef = useRef(false);

    const modelMap = params.data?.models;
    const subtypes = useMemo(() => Object.keys(modelMap ?? {}), [modelMap]);

    async function start() {
        if (!modelMap || running) {
            return;
        }
        const types = subtype === 'all' ? subtypes : [subtype];
        const list = types.flatMap(type => (modelMap[type] ?? []).map(([name]) => ({ name, type })));
        stopRef.current = false;
        setRunning(true);
        setStopping(false);
        setFinished(false);
        try {
            await runMetadataScan(list, { dateRange, filter, replace, nameFilter }, setProgress, () => stopRef.current);
        }
        finally {
            setRunning(false);
            setStopping(false);
            setFinished(true);
            queryClient.invalidateQueries({ queryKey: ['models'] });
            queryClient.invalidateQueries({ queryKey: queryKeys.t2iParams });
        }
    }

    const disabled = !canEdit || running;

    return (
        <section className="mt-4 border-t border-subtle pt-3">
            <h2 className="text-sm font-medium text-fg-strong">{t('metadataScan.title')}</h2>
            <p className="mb-2 text-xs text-fg-soft">{t('metadataScan.about')}</p>

            <Field id="scan-subtype" label={t('metadataScan.subtype')} density="compact">
                <select id="scan-subtype" value={subtype} disabled={disabled} onChange={e => setSubtype(e.target.value)} className={SELECT}>
                    <option value="all">{t('metadataScan.subtypeAll')}</option>
                    {subtypes.map(type => (
                        <option key={type} value={type}>
                            {type}
                        </option>
                    ))}
                </select>
            </Field>
            <Field id="scan-date" label={t('metadataScan.dateRange')} density="compact">
                <select id="scan-date" value={dateRange} disabled={disabled} onChange={e => setDateRange(e.target.value as ScanDateRange)} className={SELECT}>
                    {SCAN_DATE_RANGES.map(option => (
                        <option key={option} value={option}>
                            {t(`metadataScan.date.${option}`)}
                        </option>
                    ))}
                </select>
            </Field>
            <Field id="scan-filter" label={t('metadataScan.filter')} density="compact">
                <select id="scan-filter" value={filter} disabled={disabled} onChange={e => setFilter(e.target.value as ScanFilter)} className={SELECT}>
                    {SCAN_FILTERS.map(option => (
                        <option key={option} value={option}>
                            {t(`metadataScan.filterOption.${option}`)}
                        </option>
                    ))}
                </select>
            </Field>
            <Field id="scan-replace" label={t('metadataScan.replace')} density="compact">
                <select id="scan-replace" value={replace} disabled={disabled} onChange={e => setReplace(e.target.value as ScanReplace)} className={SELECT}>
                    {SCAN_REPLACES.map(option => (
                        <option key={option} value={option}>
                            {t(`metadataScan.replaceOption.${option}`)}
                        </option>
                    ))}
                </select>
            </Field>
            <Field id="scan-name" label={t('metadataScan.nameFilter')} description={t('metadataScan.nameFilterHelp')} density="compact">
                <input
                    id="scan-name"
                    type="text"
                    value={nameFilter}
                    disabled={disabled}
                    placeholder={t('metadataScan.nameFilterPlaceholder')}
                    onChange={e => setNameFilter(e.target.value)}
                    className={`${SELECT} w-full`}
                />
            </Field>

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    disabled={disabled || !modelMap}
                    onClick={() => setConfirming(true)}
                    className="rounded px-3 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {running ? t('metadataScan.running') : t('metadataScan.start')}
                </button>
                {running && (
                    <button
                        type="button"
                        disabled={stopping}
                        onClick={() => {
                            stopRef.current = true;
                            setStopping(true);
                        }}
                        className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)] disabled:opacity-50"
                    >
                        {stopping ? t('metadataScan.stopping') : t('metadataScan.stop')}
                    </button>
                )}
            </div>

            {!canEdit && (
                <p className="mt-2 text-sm" style={{ color: 'var(--status-bar-warn-color-start-end)' }}>
                    {t('metadataScan.noPermission')}
                </p>
            )}

            {progress && (
                <p className="mt-2 text-sm text-fg-soft tabular-nums" role="status">
                    {finished
                        ? t('metadataScan.done', {
                              scanned: progress.scanned,
                              failed: progress.failed,
                              skipped: progress.skipped,
                              updated: progress.updated
                          })
                        : t('metadataScan.progress', {
                              running: progress.running,
                              scanned: progress.scanned,
                              failed: progress.failed,
                              skipped: progress.skipped,
                              updated: progress.updated,
                              remaining: progress.total - progress.scanned - progress.failed - progress.skipped,
                              total: progress.total
                          })}
                </p>
            )}

            <ConfirmDialog
                open={confirming}
                title={t('metadataScan.confirmTitle')}
                body={t('metadataScan.confirmBody')}
                confirmLabel={t('metadataScan.start')}
                onConfirm={() => {
                    setConfirming(false);
                    start();
                }}
                onCancel={() => setConfirming(false)}
            />
        </section>
    );
}
