/** Public surface of the translation system.
 *
 * In components use `useTranslation()`, which re-renders on a language switch:
 *
 *     const { t } = useTranslation();
 *     <button>{t('common.save')}</button>
 *     <p>{t('library.models.countShown', { count: shown, total })}</p>
 *
 * At module scope (route tables, constant lists) call `t` directly from here — it reads the same
 * live tables, it just can't tell React to re-render, so only use it where the value is read
 * during a render that something else already triggers.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys, useSession } from '@/api/hooks';
import { libraryKeys, useMyUserData } from '@/library/hooks';
import { DEFAULT_LANGUAGE, LANGUAGES, findLanguage, type LanguageInfo } from './languages';
import { cleanDynamicTable, t, tDynamic, useI18nStore, type Messages, type TranslationVars } from './store';

export { LANGUAGES, DEFAULT_LANGUAGE, findLanguage, normalizeLanguage } from './languages';
export type { LanguageInfo } from './languages';
export { bootstrapI18n, hasTranslation, t, tDynamic, useI18nStore } from './store';
export type { Messages, TranslationVars } from './store';

export interface Translator {
    /** Static UI text, by semantic identifier. */
    t: (key: string, vars?: TranslationVars) => string;
    /** Server-supplied text, by its English source string. */
    tDynamic: (text: string | null | undefined) => string;
    language: string;
}

/** Translation functions bound to the active language. */
export function useTranslation(): Translator {
    const revision = useI18nStore(state => state.revision);
    const language = useI18nStore(state => state.language);
    // Rebuilt whenever the tables change, so callers that memoize on `t` recompute on a switch.
    return useMemo(
        () => ({
            t: (key: string, vars?: TranslationVars) => t(key, vars),
            tDynamic: (text: string | null | undefined) => tDynamic(text),
            language
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the invalidation signal
        [revision, language]
    );
}

export interface LanguageControl {
    current: LanguageInfo;
    available: LanguageInfo[];
    /** False while a newly picked language's tables are still downloading. */
    ready: boolean;
    setLanguage: (code: string) => void;
}

/** Backs the language picker in Settings. */
export function useLanguage(): LanguageControl {
    const queryClient = useQueryClient();
    const language = useI18nStore(state => state.language);
    const ready = useI18nStore(state => state.ready);
    const setLanguage = useI18nStore(state => state.setLanguage);

    const change = useCallback(
        (code: string) => {
            void (async () => {
                await setLanguage(code);
                // Persist to the user profile, the same way the theme picker does, so the choice
                // follows the account to another browser and the existing interface agrees with it.
                // Best-effort: a user without edit_user_settings still gets the language they
                // picked for this browser, held by the cookie.
                try {
                    await api.post('ChangeUserSettings', { settings: { language: code } });
                    await queryClient.invalidateQueries({ queryKey: queryKeys.userSettings });
                    await queryClient.invalidateQueries({ queryKey: libraryKeys.userData });
                }
                catch {
                    // Ignored deliberately - see above.
                }
            })();
        },
        [setLanguage, queryClient]
    );

    return {
        current: findLanguage(language) ?? LANGUAGES[0],
        available: LANGUAGES,
        ready,
        setLanguage: change
    };
}

/** Keeps translations in step with the session. Mount once, in the app shell.
 *
 * Two jobs: pull the server-keyed table (which needs a session, so it can't happen at bootstrap),
 * and adopt the language stored in the user's profile for a browser that hasn't chosen one.
 *
 * The fetch lives here rather than in the store because the API client depends on the store for
 * its own error messages, and the reverse dependency would close a cycle. */
export function useTranslationSync(): void {
    const session = useSession();
    const userData = useMyUserData(session.isSuccess);
    const setDynamic = useI18nStore(state => state.setDynamic);
    const adoptServerLanguage = useI18nStore(state => state.adoptServerLanguage);
    const language = useI18nStore(state => state.language);

    useEffect(() => {
        if (!session.isSuccess || language === DEFAULT_LANGUAGE) {
            setDynamic(language, {});
            return;
        }
        let cancelled = false;
        // Best-effort: without this table (no permission, older server) server-supplied text such
        // as parameter names simply stays in English, which is still readable.
        api.post<{ language: { keys: Messages } }>('GetLanguage', { language })
            .then(data => {
                if (!cancelled) {
                    setDynamic(language, cleanDynamicTable(data.language?.keys));
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setDynamic(language, {});
                }
            });
        return () => {
            cancelled = true;
        };
    }, [session.isSuccess, language, setDynamic]);

    useEffect(() => {
        adoptServerLanguage(userData.data?.language);
    }, [userData.data?.language, adoptServerLanguage]);
}
