import { useMemo } from 'react';
import { Copy, ImageOff, Star, Trash2, X } from 'lucide-react';
import { previewUrl, type PresetEntry } from '@/library/types';
import { useParamSchema } from '@/params/schema';
import { DetailSheet } from '../ui/DetailSheet';
import { useTranslation } from '@/i18n';

/** Side sheet for one saved preset: what it is for, and every parameter it would put into the
 *  panel.
 *
 * The parameter list is the half that cannot be seen from the grid. A preset's title says what it
 * was meant for and its description says why, but only the list says what applying it will
 * actually change - which is the question worth asking before handing the panel over to it. */
export function PresetDetailSheet(props: {
    preset: PresetEntry;
    starred: boolean;
    canManage: boolean;
    onApply: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onStar: () => void;
    onClose: () => void;
}) {
    const { t, tDynamic } = useTranslation();
    const schema = useParamSchema();
    const { preset } = props;
    const image = previewUrl(preset.preview_image);

    // Panel order, so the sheet reads the way the parameters it is about are laid out. A parameter
    // this install has never heard of - one from an extension that is not here - keeps its raw id
    // and sorts last, since there is no priority to place it by.
    const rows = useMemo(() => {
        return Object.entries(preset.param_map ?? {})
            .map(([id, value]) => {
                const param = schema?.byId.get(id);
                return {
                    id,
                    label: param ? tDynamic(param.name) : id,
                    known: param !== undefined,
                    priority: param?.priority ?? Number.MAX_SAFE_INTEGER,
                    text: value === null || value === undefined ? '' : String(value)
                };
            })
            .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
    }, [preset.param_map, schema, tDynamic]);

    return (
        <DetailSheet label={t('presetDetail.title')} onClose={props.onClose}>
            <div className="flex shrink-0 items-start gap-2 border-b border-subtle p-3">
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong" title={preset.title}>
                    {preset.title}
                </h2>
                <SheetIcon
                    label={props.starred ? t('common.unstar') : t('common.star')}
                    onClick={props.onStar}
                    color={props.starred ? 'var(--star)' : undefined}
                >
                    <Star size={15} fill={props.starred ? 'currentColor' : 'none'} aria-hidden />
                </SheetIcon>
                {props.canManage && (
                    <>
                        <SheetIcon label={t('common.duplicate')} onClick={props.onDuplicate}>
                            <Copy size={15} aria-hidden />
                        </SheetIcon>
                        <SheetIcon
                            label={t('common.delete')}
                            onClick={props.onDelete}
                            color="var(--backend-errored)"
                        >
                            <Trash2 size={15} aria-hidden />
                        </SheetIcon>
                    </>
                )}
                <SheetIcon label={t('common.closeDetails')} onClick={props.onClose}>
                    <X size={15} aria-hidden />
                </SheetIcon>
            </div>

            {/* The one thing this screen is really for, so it gets a row of its own rather than an
                icon among the housekeeping ones above. */}
            <div className="shrink-0 border-b border-subtle px-3 py-2">
                <button
                    type="button"
                    onClick={props.onApply}
                    className="w-full rounded px-3 py-1.5 text-sm"
                    style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                >
                    {t('presets.applyParameters')}
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {image ? (
                    // Capped in the bottom sheet, where a full-width preview would push the
                    // parameter list off the bottom of the screen.
                    <img
                        src={image}
                        alt=""
                        className="mb-3 max-h-64 w-full rounded border border-subtle object-cover lg:max-h-none"
                    />
                ) : (
                    <div className="mb-3 flex aspect-video items-center justify-center rounded border border-subtle bg-surface-sunken">
                        <ImageOff size={20} className="text-fg-soft opacity-40" aria-hidden />
                    </div>
                )}

                <p className="whitespace-pre-wrap break-words text-sm text-fg-soft">
                    {preset.description || t('presetDetail.noDescription')}
                </p>

                <h3 className="mb-1 mt-3 text-xs uppercase tracking-wide text-fg-soft">
                    {t('presets.parameterCount', { count: rows.length })}
                </h3>
                {rows.length === 0 ? (
                    <p className="text-xs text-fg-soft">{t('presetDetail.noParameters')}</p>
                ) : (
                    <dl className="space-y-0.5 border-t border-subtle pt-1.5 text-xs">
                        {rows.map(row => (
                            <div key={row.id} className="flex gap-2 py-0.5">
                                {/* An id this install has no parameter for is shown as the id
                                    itself, in mono, so it reads as the raw thing it is rather
                                    than as a label that happens to be oddly worded. */}
                                <dt
                                    className={[
                                        'w-[7rem] shrink-0 truncate',
                                        row.known ? 'text-fg-soft' : 'font-mono text-fg-soft'
                                    ].join(' ')}
                                    title={row.known ? row.label : t('presetDetail.unknownParameter', { id: row.id })}
                                >
                                    {row.label}
                                </dt>
                                <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-fg">
                                    {row.text || t('presetDetail.emptyValue')}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </DetailSheet>
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
