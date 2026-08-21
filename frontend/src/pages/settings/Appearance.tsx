import { Check, Languages, Moon, Sun } from 'lucide-react';
import { useThemes } from '@/theme/useTheme';
import { PRESETS, useLayoutStore, type LayoutPreset } from '@/generate/layout';
import { Field } from '@/components/form/Field';
import { useLanguage, useTranslation } from '@/i18n';

export function AppearancePage() {
    const { t } = useTranslation();
    const { themes, current, setTheme, isPending } = useThemes();
    const preset = useLayoutStore(s => s.preset);
    const applyPreset = useLayoutStore(s => s.applyPreset);

    const entries = Object.entries(themes);

    return (
        <div className="h-full overflow-y-auto p-4">
            <div className="grid max-w-3xl gap-3" style={{ ['--sw-field-label-width' as string]: '10rem' }}>
                <LanguagePanel />

                <section className="rounded-lg border border-default bg-surface p-4">
                    <h2 className="text-sm font-medium text-fg-strong">{t('appearance.theme.title')}</h2>
                    <p className="mb-3 text-xs text-fg-soft">{t('appearance.theme.sharedNote')}</p>

                    {isPending ? (
                        <p className="text-sm text-fg-soft">{t('appearance.theme.loading')}</p>
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
                    <h2 className="mb-2 text-sm font-medium text-fg-strong">{t('appearance.layout.title')}</h2>
                    <Field id="layout-preset" label={t('appearance.layout.panePreset')} density="compact">
                        <select
                            id="layout-preset"
                            value={preset}
                            onChange={e => applyPreset(e.target.value as LayoutPreset)}
                            className="rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                        >
                            {(Object.keys(PRESETS) as LayoutPreset[]).map(id => (
                                <option key={id} value={id}>
                                    {t(PRESETS[id].labelKey)}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <p className="mt-1 text-xs text-fg-soft">{t('appearance.layout.dragNote')}</p>
                </section>
            </div>
        </div>
    );
}

/** Language picker.
 *
 * Sits with Theme because it is the same kind of choice — how the interface presents itself — and
 * because both are stored on the user profile, so both follow the account to another browser. */
function LanguagePanel() {
    const { t } = useTranslation();
    const { current, available, ready, setLanguage } = useLanguage();

    return (
        <section className="rounded-lg border border-default bg-surface p-4">
            <h2 className="text-sm font-medium text-fg-strong">{t('appearance.language.title')}</h2>
            <p className="mb-3 text-xs text-fg-soft">{t('appearance.language.sharedNote')}</p>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
                {available.map(language => {
                    const active = language.code === current.code;
                    return (
                        <button
                            key={language.code}
                            type="button"
                            onClick={() => setLanguage(language.code)}
                            disabled={!ready && !active}
                            aria-pressed={active}
                            lang={language.code}
                            className="flex items-center gap-2 rounded-lg border p-2 text-left transition-colors disabled:opacity-60"
                            style={{
                                borderColor: active ? 'var(--emphasis)' : 'var(--border-color)',
                                background: active ? 'var(--sw-active)' : 'transparent'
                            }}
                        >
                            <Languages size={14} className="shrink-0 text-fg-soft" aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-sm text-fg">
                                {language.localName}
                            </span>
                            {active && (
                                <Check size={14} className="shrink-0" style={{ color: 'var(--emphasis)' }} aria-hidden />
                            )}
                        </button>
                    );
                })}
            </div>
            <p className="mt-2 text-xs text-fg-soft">{t('appearance.language.credit')}</p>
        </section>
    );
}
