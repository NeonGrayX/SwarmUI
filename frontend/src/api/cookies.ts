/** Browser cookie access.
 *
 * Its own module rather than part of client.ts so that the i18n store — which shares the
 * `display_language` cookie with the existing interface — can read and write cookies without
 * depending on the API client, which in turn depends on i18n for its error messages.
 *
 * Mirrors getCookie/setCookie in src/wwwroot/js/util.js.
 */

/** Reads a browser cookie by name, or null when unset. */
export function readCookie(name: string): string | null {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
        const trimmed = part.trimStart();
        if (trimmed.startsWith(prefix)) {
            return decodeURIComponent(trimmed.slice(prefix.length));
        }
    }
    return null;
}

/** Writes a browser cookie with a day-based expiry. */
export function writeCookie(name: string, value: string, days: number): void {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}
