import { ChevronRight } from 'lucide-react';
import type { ParamSchema } from '@/api/types';
import type { GroupNode } from '@/params/schema';
import type { VisibilityResult } from '@/params/visibility';
import { companionParams } from '@/params/loras';
import { useParamStore, valueOf } from '@/params/store';
import { Field } from './Field';
import { ParamControl } from './controls';
import { useTranslation } from '@/i18n';

interface Props {
    node: GroupNode;
    visibility: VisibilityResult;
    /** Forces groups open while a search is active, so hits are never buried. */
    forceOpen: boolean;
    depth?: number;
}

/** A collapsible parameter group. The header carries a count of altered descendants, so a
 *  collapsed group still says whether it holds changes. */
export function ParamGroup(props: Props) {
    const { t, tDynamic } = useTranslation();
    const { node, visibility } = props;
    const depth = props.depth ?? 0;
    const openGroups = useParamStore(s => s.openGroups);
    const setGroupOpen = useParamStore(s => s.setGroupOpen);
    const groupToggles = useParamStore(s => s.groupToggles);
    const setGroupToggle = useParamStore(s => s.setGroupToggle);

    if (!visibility.visibleGroups.has(node.group.id)) {
        return null;
    }

    const isOpen = props.forceOpen || (openGroups[node.group.id] ?? node.group.open);
    const alteredCount = visibility.alteredCountByGroup.get(node.group.id) ?? 0;
    const groupOn = groupToggles[node.group.id] === true;
    const visibleParams = node.params.filter(p => visibility.visible.has(p.id));

    return (
        <section className={depth > 0 ? 'ml-3 border-l border-subtle pl-2' : ''}>
            <div className="flex items-center gap-1.5 py-1">
                <button
                    type="button"
                    onClick={() => setGroupOpen(node.group.id, !isOpen)}
                    aria-expanded={isOpen}
                    className="flex items-center gap-1 min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-[var(--sw-hover)]"
                >
                    <ChevronRight
                        size={14}
                        aria-hidden
                        className={`shrink-0 text-fg-soft transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                    {/* Group names are defined server-side, so they translate by source text. */}
                    <span className="truncate text-sm font-medium text-fg-strong">
                        {tDynamic(node.group.name)}
                    </span>
                    {alteredCount > 0 && (
                        <span
                            title={t('params.changedFromDefaultCount', { count: alteredCount })}
                            className="shrink-0 rounded-full px-1.5 text-[10px] leading-4 text-fg-strong"
                            style={{ background: 'var(--sw-chip-bg)' }}
                        >
                            {alteredCount}
                        </span>
                    )}
                </button>
                {node.group.toggles && (
                    <input
                        type="checkbox"
                        checked={groupOn}
                        onChange={e => setGroupToggle(node.group.id, e.target.checked)}
                        aria-label={t('field.enable', { label: tDynamic(node.group.name) })}
                        title={t('field.enable', { label: tDynamic(node.group.name) })}
                        className="shrink-0 accent-[var(--emphasis)]"
                    />
                )}
            </div>

            {isOpen && (
                <div className="pl-1">
                    {visibleParams.map(param => (
                        <ParamField
                            key={param.id}
                            param={param}
                            visibility={visibility}
                            groupDisabled={node.group.toggles && !groupOn}
                        />
                    ))}
                    {node.children.map(child => (
                        <ParamGroup
                            key={child.group.id}
                            node={child}
                            visibility={visibility}
                            forceOpen={props.forceOpen}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

export function ParamField(props: {
    param: ParamSchema;
    visibility: VisibilityResult;
    groupDisabled?: boolean;
}) {
    const { t, tDynamic } = useTranslation();
    const { param, visibility } = props;
    const values = useParamStore(s => s.values);
    const toggles = useParamStore(s => s.toggles);
    const setValue = useParamStore(s => s.setValue);
    const setToggle = useParamStore(s => s.setToggle);
    const reset = useParamStore(s => s.reset);

    const unsupported = visibility.unsupported.has(param.id);
    const toggledOff = param.toggleable && toggles[param.id] !== true;
    // Off for a reason the row's own toggle cannot undo, so that toggle dims with the rest of it.
    const blocked = unsupported || props.groupDisabled === true;
    const disabled = blocked || toggledOff;

    return (
        <Field
            id={`param-${param.id}`}
            label={tDynamic(param.name)}
            description={tDynamic(param.description)}
            examples={param.examples}
            density="compact"
            modified={visibility.altered.has(param.id)}
            onReset={() => {
                reset(param.id);
                for (const companion of companionParams(param.id)) {
                    reset(companion);
                }
            }}
            disabled={disabled}
            toggleBlocked={blocked}
            disabledReason={
                unsupported
                    ? t('params.requiresFeature', { feature: param.feature_flag ?? '' })
                    : props.groupDisabled
                      ? t('params.groupSwitchedOff')
                      : undefined
            }
            toggle={
                param.toggleable
                    ? { on: toggles[param.id] === true, onChange: on => setToggle(param.id, on) }
                    : undefined
            }
        >
            <ParamControl
                param={param}
                value={valueOf(param, values)}
                disabled={disabled}
                onChange={next => {
                    setValue(param.id, next);
                    // Touching a toggleable param implies switching it on.
                    if (param.toggleable && toggles[param.id] !== true) {
                        setToggle(param.id, true);
                    }
                }}
            />
        </Field>
    );
}
