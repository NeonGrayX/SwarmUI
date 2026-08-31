/** Translation state: which language is active, and the message tables behind `t` / `tDynamic`.
 *
 * There are two separate layers, because the strings in this UI come from two places:
 *
 *  1. **Static UI text** — everything written in this codebase. Keyed by semantic identifiers
 *     (`server.backends.addBackend`) in `src/i18n/locales/<code>.json`, so a translator sees a
 *     stable name rather than an English sentence that shifts under them on every copy edit.
 *
 *  2. **Server-provided text** — T2I parameter names and descriptions, settings tree labels,
 *     backend type titles. Those strings never exist in this codebase, so they can't have
 *     identifiers here. The existing interface translated them by looking the English source text
 *     up in /languages/<code>.json, and `tDynamic` does exactly the same via the GetLanguage API,
 *     which means the several hundred parameter/settings translations already written for that
 *     interface apply here unchanged.
 *
 * This module deliberately does not import the API client: the client asks `t` for its own error
 * messages, so a dependency the other way would be a cycle. Fetching the server-keyed table is
 * therefore the job of `useTranslationSync` in ./index.ts, which hands the result to `setDynamic`.
 */

import { create } from 'zustand';
import { readCookie, writeCookie } from '@/api/cookies';
import en from './locales/en.json';
import { DEFAULT_LANGUAGE, detectBrowserLanguage, findLanguage, normalizeLanguage } from './languages';

export type Messages = Record<string, string>;

/** Values substitutable into a message's `{placeholder}` slots. */
export type TranslationVars = Record<string, string | number>;

/** Cookie name shared with the existing interface (src/wwwroot/js/translator.js), so switching
 *  language in either UI carries over to the other. */
const LANGUAGE_COOKIE = 'display_language';
const COOKIE_DAYS = 365;

/** Locale tables, resolved lazily so a session only downloads the language it's actually using.
 *  English is excluded: it is statically imported above as the fallback table, and listing it here
 *  too would only defeat the code-splitting. */
const LOCALE_LOADERS = import.meta.glob<{ default: Messages }>([
    './locales/*.json',
    '!./locales/en.json'
]);

const ENGLISH = en as Messages;

/** Live copy of the active tables, so the plain `t`/`tDynamic` functions work outside React too
 *  (route definitions, validation messages, and other module-scope callers). */
let activeMessages: Messages = ENGLISH;
let activeDynamic: Messages = {};

/** Fills `{name}` placeholders. Unknown names are left alone rather than blanked, so a typo in a
 *  translation shows up as visible `{whatever}` instead of silently losing content. */
function interpolate(text: string, vars?: TranslationVars): string {
    if (!vars) {
        return text;
    }
    return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in vars ? String(vars[name]) : whole
    );
}

/** Looks up a static UI string by identifier.
 *
 * Falls back through the active language, then English, then the identifier itself — a missing
 * translation degrades to readable English rather than to a blank or a raw key.
 *
 * Pass `count` to select a plural form: `items.count` resolves to `items.count.one` for exactly
 * one and `items.count.other` otherwise, falling back to the bare identifier when no plural forms
 * are defined. */
export function t(key: string, vars?: TranslationVars): string {
    let resolved: string | undefined;
    if (vars && typeof vars.count === 'number') {
        const plural = `${key}.${vars.count === 1 ? 'one' : 'other'}`;
        resolved = activeMessages[plural] ?? ENGLISH[plural];
    }
    resolved ??= activeMessages[key] ?? ENGLISH[key];
    if (resolved === undefined) {
        if (import.meta.env.DEV) {
            console.warn(`[i18n] Missing translation identifier: ${key}`);
        }
        return key;
    }
    return interpolate(resolved, vars);
}

/** Joins a sentence-tail fragment onto the element before it.
 *
 * Sentences like "Your account doesn't have the `x` permission." are assembled from a leading
 * fragment, a `<code>` element, and a trailing one, so the trailing fragment needs a space in
 * front of it — except where a language reduced it to bare punctuation, which would then render
 * as "`x` ." Languages that end the sentence with a comma clause have the same problem. */
export function trailingFragment(text: string): string {
    return /^[\s]*[.,;:!?。、，؟،]/.test(text) ? text : ` ${text}`;
}

/** True when a static identifier exists at all, for optional labels. */
export function hasTranslation(key: string): boolean {
    return key in activeMessages || key in ENGLISH;
}

/** Translates a string that came from the server, by matching its English source text.
 *
 * Used for parameter names, settings descriptions, and other text this codebase never authors.
 * Untranslated text passes straight through, which is the correct result for names the language
 * files intentionally leave alone (model file names, backend IDs, user names). */
export function tDynamic(text: string | null | undefined): string {
    if (!text) {
        return text ?? '';
    }
    return activeDynamic[text] || text;
}

interface I18nState {
    /** Active language code, always one of LANGUAGES. */
    language: string;
    /** True once the active language's static table has loaded. English is ready immediately. */
    ready: boolean;
    /** Bumped on every table swap, purely so subscribed components re-render. */
    revision: number;
    /** Switches language, loading its tables and persisting the choice. */
    setLanguage: (code: string) => Promise<void>;
    /** Installs the server-side (English-keyed) table. Fetched by useTranslationSync, which has
     *  the API client; see the note at the top of this file. */
    setDynamic: (language: string, table: Messages) => void;
    /** Adopts the language stored in the user's server-side profile, unless this browser has
     *  already made an explicit local choice. */
    adoptServerLanguage: (code: string | null | undefined) => void;
}

/** The language this browser should start in, before any server data arrives.
 *  Cookie first (an explicit past choice, possibly made in the other UI), browser hint after. */
export function initialLanguage(): string {
    return normalizeLanguage(readCookie(LANGUAGE_COOKIE)) ?? detectBrowserLanguage();
}

/** Applies document-level effects of a language: the `lang` attribute for spellcheck and
 *  screen readers, and `dir` so Arabic lays out right-to-left. */
function applyDocumentLanguage(code: string): void {
    document.documentElement.lang = code;
    document.documentElement.dir = findLanguage(code)?.rtl ? 'rtl' : 'ltr';
}

async function loadMessages(code: string): Promise<Messages> {
    if (code === DEFAULT_LANGUAGE) {
        return ENGLISH;
    }
    const loader = LOCALE_LOADERS[`./locales/${code}.json`];
    if (!loader) {
        return ENGLISH;
    }
    const loaded = await loader();
    // Merge over English so an identifier the translator hasn't reached yet still renders.
    return { ...ENGLISH, ...loaded.default };
}

/** Cleans a raw GetLanguage payload into a lookup table.
 *
 * The language files carry empty strings for untranslated entries; dropping them here means
 * `tDynamic` does not have to treat '' specially on every single lookup. */
export function cleanDynamicTable(keys: Messages | undefined): Messages {
    return Object.fromEntries(Object.entries(keys ?? {}).filter(([, value]) => value));
}

export const useI18nStore = create<I18nState>((set, get) => ({
    language: DEFAULT_LANGUAGE,
    ready: true,
    revision: 0,

    setLanguage: async (code: string) => {
        const target = normalizeLanguage(code) ?? DEFAULT_LANGUAGE;
        set({ ready: false });
        activeMessages = await loadMessages(target);
        // Server-supplied text stays in whatever the previous language resolved it to until the
        // new table arrives, which is a beat later and only affects parameter names.
        activeDynamic = {};
        applyDocumentLanguage(target);
        writeCookie(LANGUAGE_COOKIE, target, COOKIE_DAYS);
        set(state => ({ language: target, ready: true, revision: state.revision + 1 }));
    },

    setDynamic: (language: string, table: Messages) => {
        if (get().language !== language) {
            // The language changed while the fetch was in flight; that switch has its own table.
            return;
        }
        activeDynamic = table;
        set(state => ({ revision: state.revision + 1 }));
    },

    adoptServerLanguage: (code: string | null | undefined) => {
        const target = normalizeLanguage(code);
        if (!target || target === get().language) {
            return;
        }
        // An explicit choice stored in this browser wins, so a shared/admin account's default
        // can't keep overriding what the person in front of the screen picked.
        if (normalizeLanguage(readCookie(LANGUAGE_COOKIE))) {
            return;
        }
        void get().setLanguage(target);
    }
}));

/** Loads the startup language before React renders, so the first paint is already translated. */
export async function bootstrapI18n(): Promise<void> {
    const target = initialLanguage();
    applyDocumentLanguage(target);
    if (target === DEFAULT_LANGUAGE) {
        useI18nStore.setState({ language: target });
        return;
    }
    activeMessages = await loadMessages(target);
    useI18nStore.setState(state => ({ language: target, ready: true, revision: state.revision + 1 }));
}
