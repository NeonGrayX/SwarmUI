import { Check, Moon, Sun } from 'lucide-react';
import { useThemes } from '@/theme/useTheme';
import { PRESETS, useLayoutStore, type LayoutPreset } from '@/generate/layout';
import { Field } from '@/components/form/Field';

export function AppearancePage() {
    const { themes, current, setTheme, isPending } = useThemes();
    const preset = useLayoutStore(s => s.preset);
    const applyPreset = useLayoutStore(s => s.applyPreset);

    const entries = Object.entries(themes);

    return (
        <div className="h-full overflow-y-auto p-4">
            <div className="grid max-w-3xl gap-3" style={{ ['--sw-field-label-width' as string]: '10rem' }}>
                <section className="rounded-lg border border-default bg-surface p-4">
                    <h2 className="text-sm font-medium text-fg-strong">Theme</h2>
                    <p className="mb-3 text-xs text-fg-soft">
                        Shared with the existing interface — changing it here changes it there too.
                    </p>

                    {isPending ? (
                        <p className="text-sm text-fg-soft">Loading themes…</p>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
                            {entries.map(([id, theme]) => {
                                const active = id === current;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setTheme(id)}
                                        aria-pressed={active}
                                        className="flex items-center gap-2 rounded-lg border p-2 text-left transition-colors"
                                        style={{
                                            borderColor: active ? 'var(--emphasis)' : 'var(--border-color)',
                                            background: active ? 'var(--sw-active)' : 'transparent'
                                        }}
                                    >
                                        {theme.is_dark ? (
                                            <Moon size={14} className="shrink-0 text-fg-soft" aria-hidden />
                                        ) : (
                                            <Sun size={14} className="shrink-0 text-fg-soft" aria-hidden />
                                        )}
                                        <span className="min-w-0 flex-1 truncate text-sm text-fg">
                                            {theme.name}
                                        </span>
                                        {active && (
                                            <Check size={14} className="shrink-0" style={{ color: 'var(--emphasis)' }} aria-hidden />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className="rounded-lg border border-default bg-surface p-4">
                    <h2 className="mb-2 text-sm font-medium text-fg-strong">Generate layout</h2>
                    <Field id="layout-preset" label="Pane preset" density="compact">
                        <select
                            id="layout-preset"
                            value={preset}
                            onChange={e => applyPreset(e.target.value as LayoutPreset)}
                            className="rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                        >
                            {(Object.keys(PRESETS) as LayoutPreset[]).map(id => (
                                <option key={id} value={id}>
                                    {PRESETS[id].label}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <p className="mt-1 text-xs text-fg-soft">
                        Panes can also be dragged directly in the Generate workspace; sizes are
                        remembered in this browser.
                    </p>
                </section>
            </div>
        </div>
    );
}
