import type { ToolOption } from '@/editor/types';
import { useEditorStore, useEditorVersion } from '@/editor/store';
import { ColorField } from './ColorField';
import { useTranslation } from '@/i18n';

/** The active tool's option bar, along the bottom of the editor. Tools describe their controls as
 *  data (`EditorTool.getOptions`) and this renders them, so every tool's options are themed,
 *  translated and keyboard-reachable without arranging for it individually. */
export function ToolOptions() {
    const engine = useEditorStore(s => s.engine);
    useEditorVersion();
    const tool = engine.optionsTool;
    const options = tool.getOptions();

    if (options.length === 0) {
        return null;
    }

    return (
        // Capped and scrollable on a phone, where a tool that wraps to three rows would otherwise
        // take more of the height than the canvas it belongs to. The cap is two full rows and a
        // sliver of a third, which is what every tool but the brush needs outright.
        <div className="flex max-h-19 shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 overflow-y-auto border-t border-subtle bg-surface px-3 py-1.5 lg:max-h-28">
            {options.map(option => (
                <OptionControl
                    key={option.key}
                    option={option}
                    onChange={(value: string | number | boolean) => tool.setOption(option.key, value)}
                />
            ))}
        </div>
    );
}

function OptionControl(props: { option: ToolOption; onChange: (value: string | number | boolean) => void }) {
    const { t } = useTranslation();
    const engine = useEditorStore(s => s.engine);
    const { option } = props;

    if (option.kind === 'color') {
        return (
            <ColorField
                value={option.value}
                grayscale={option.grayscale}
                picking={option.picking}
                onChange={props.onChange}
                onPick={() => engine.optionsTool.setOption('color:pick', true)}
            />
        );
    }

    if (option.kind === 'slider') {
        return (
            <label
                className="flex items-center gap-1.5 text-xs text-fg-soft"
                style={option.disabled ? { opacity: 0.5 } : undefined}
            >
                {t(option.labelKey)}
                <input
                    type="range"
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    value={option.value}
                    disabled={option.disabled}
                    onChange={e => props.onChange(Number(e.target.value))}
                    className="w-28 accent-[var(--emphasis)]"
                />
                <input
                    type="number"
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    value={option.value}
                    disabled={option.disabled}
                    onChange={e => props.onChange(Number(e.target.value))}
                    className="w-14 rounded border border-default bg-surface-sunken px-1 py-0.5 text-right text-xs tabular-nums text-fg outline-none focus:border-[var(--emphasis)]"
                />
                {option.unit && <span aria-hidden>{option.unit}</span>}
            </label>
        );
    }

    if (option.kind === 'select') {
        return (
            <label className="flex items-center gap-1.5 text-xs text-fg-soft">
                {t(option.labelKey)}
                <select
                    value={option.value}
                    onChange={e => props.onChange(e.target.value)}
                    className="rounded border border-default bg-surface-sunken px-1.5 py-0.5 text-xs text-fg outline-none focus:border-[var(--emphasis)]"
                >
                    {option.choices.map(choice => (
                        <option key={choice.value} value={choice.value}>
                            {t(choice.labelKey)}
                        </option>
                    ))}
                </select>
            </label>
        );
    }

    if (option.kind === 'checkbox') {
        return (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-soft">
                <input
                    type="checkbox"
                    checked={option.value}
                    onChange={e => props.onChange(e.target.checked)}
                    className="accent-[var(--emphasis)]"
                />
                {t(option.labelKey)}
            </label>
        );
    }

    if (option.kind === 'button') {
        return (
            <button
                type="button"
                disabled={option.disabled}
                onClick={() => props.onChange(true)}
                className="rounded border border-default px-2 py-0.5 text-xs text-fg hover:bg-[var(--sw-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
            >
                {t(option.labelKey)}
            </button>
        );
    }

    return <span className="text-xs italic text-fg-soft">{t(option.labelKey)}</span>;
}
