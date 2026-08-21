/** The set of languages this UI ships translations for.
 *
 * Deliberately mirrors the files in /languages/*.json at the repo root, which is what the existing
 * interface and the `Language` user setting use — so a choice made here means the same thing there.
 * Adding a language means adding `src/i18n/locales/<code>.json` and an entry below; the loader in
 * store.ts globs the locales folder, so nothing else needs touching.
 */

export interface LanguageInfo {
    /** ISO-ish code, matching the language file name, eg 'de'. */
    code: string;
    /** Name of the language in English. */
    name: string;
    /** Name of the language in its own language, which is what we show in pickers. */
    localName: string;
    /** True for right-to-left scripts, which flips the document direction. */
    rtl?: boolean;
}

export const LANGUAGES: LanguageInfo[] = [
    { code: 'en', name: 'English', localName: 'English' },
    { code: 'ar', name: 'Arabic', localName: 'العربية', rtl: true },
    { code: 'de', name: 'German', localName: 'Deutsch' },
    { code: 'es', name: 'Spanish', localName: 'Español' },
    { code: 'fr', name: 'French', localName: 'Français' },
    { code: 'hi', name: 'Hindi', localName: 'हिंदी' },
    { code: 'it', name: 'Italian', localName: 'Italiano' },
    { code: 'ja', name: 'Japanese', localName: '日本語' },
    { code: 'nl', name: 'Dutch', localName: 'Nederlands' },
    { code: 'pt', name: 'Portuguese', localName: 'Português' },
    { code: 'ru', name: 'Russian', localName: 'Русский' },
    { code: 'sv', name: 'Swedish', localName: 'Svenska' },
    { code: 'tr', name: 'Turkish', localName: 'Türkçe' },
    { code: 'vi', name: 'Vietnamese', localName: 'Tiếng Việt' },
    { code: 'zh', name: 'Chinese (Simplified)', localName: '简体中文' }
];

export const DEFAULT_LANGUAGE = 'en';

const BY_CODE = new Map(LANGUAGES.map(lang => [lang.code, lang]));

export function findLanguage(code: string | null | undefined): LanguageInfo | undefined {
    return code ? BY_CODE.get(code) : undefined;
}

/** Resolves an arbitrary code to one we ship, eg 'de-DE' -> 'de'. Null when there's no match. */
export function normalizeLanguage(code: string | null | undefined): string | null {
    if (!code) {
        return null;
    }
    const trimmed = code.trim();
    if (BY_CODE.has(trimmed)) {
        return trimmed;
    }
    const base = trimmed.toLowerCase().split(/[-_]/)[0];
    return BY_CODE.has(base) ? base : null;
}

/** Best guess from the browser's stated preferences, for a user who has never chosen. */
export function detectBrowserLanguage(): string {
    for (const candidate of navigator.languages ?? [navigator.language]) {
        const match = normalizeLanguage(candidate);
        if (match) {
            return match;
        }
    }
    return DEFAULT_LANGUAGE;
}
