import { ChevronRight } from 'lucide-react';
import type { ParamSchema } from '@/api/types';
import type { GroupNode, NormalizedSchema } from '@/params/schema';
import type { VisibilityResult } from '@/params/visibility';
import { useParamStore, valueOf } from '@/params/store';
import { Field } from './Field';
import { ParamControl } from './controls';

interface Props {
    node: GroupNode;
    schema: NormalizedSchema;
    visibility: VisibilityResult;
    /** Forces groups open while a search is active, so hits are never buried. */
    forceOpen: boolean;
    depth?: number;
}

/** A collapsible parameter group.
 *
 * The header carries a count of altered descendants, so you can tell a collapsed group holds
 * changes without expanding it. In the legacy UI that information only exists once expanded, which
 * is why finding "what did I actually change" means opening all 34 groups one at a time. */
export function ParamGroup(props: Props) {
    const { node, schema, visibility } = props;
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
                    <span className="truncate text-sm font-medium text-fg-strong">{node.group.name}</span>
                    {alteredCount > 0 && (
                        <span
                            title={`${alteredCount} changed from default`}
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
                        aria-label={`Enable ${node.group.name}`}
                        title={`Enable ${node.group.name}`}
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
                            schema={schema}
                            visibility={visibility}
                            groupDisabled={node.group.toggles && !groupOn}
                        />
                    ))}
                    {node.children.map(child => (
                        <ParamGroup
                            key={child.group.id}
                            node={child}
                            schema={schema}
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
    schema: NormalizedSchema;
    visibility: VisibilityResult;
    groupDisabled?: boolean;
}) {
    const { param, schema, visibility } = props;
    const values = useParamStore(s => s.values);
    const toggles = useParamStore(s => s.toggles);
    const setValue = useParamStore(s => s.setValue);
    const setToggle = useParamStore(s => s.setToggle);
    const reset = useParamStore(s => s.reset);

    const unsupported = visibility.unsupported.has(param.id);
    const toggledOff = param.toggleable && toggles[param.id] !== true;
    const disabled = unsupported || props.groupDisabled || toggledOff;

    return (
        <Field
            id={`param-${param.id}`}
            label={param.name}
            description={param.description}
            examples={param.examples}
            density="compact"
            modified={visibility.altered.has(param.id)}
            onReset={() => reset(param.id)}
            disabled={disabled}
            disabledReason={
                unsupported
                    ? `Requires backend feature: ${param.feature_flag}`
                    : props.groupDisabled
                      ? 'This group is switched off'
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
                models={schema.models}
                disabled={disabled}
                onChange={next => {
                    setValue(param.id, next);
                    // Touching a toggleable param implies switching it on, as the legacy UI does.
                    if (param.toggleable && toggles[param.id] !== true) {
                        setToggle(param.id, true);
                    }
                }}
            />
        </Field>
    );
}
