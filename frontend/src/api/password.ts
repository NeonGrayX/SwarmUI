/** Client-side password prehashing.
 *
 * Every route that takes a password — Login, Register, ChangePassword, AdminAddUser,
 * AdminSetUserPassword — expects the value to already be prehashed by the browser. The server
 * hashes again on top of it (Utilities.HashPassword, src/Utils/Utilities.cs:1418), so sending a
 * raw password stores a hash the login page can never reproduce.
 *
 * The point is that the server owner never sees the raw password a user may reuse across sites;
 * it is not a substitute for TLS.
 */

import { t } from '@/i18n/store';

const PREHASH_PREFIX = 'swarmclientpw';
/** Marker that asks the server to do the prehash itself, so http and https agree on the result. */
const SERVER_SIDE_MARKER = '__swarmdoprehash:';

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) {
        out += byte.toString(16).padStart(2, '0');
    }
    return out;
}

/** Prehashes `password` for `userId`. Always await this before sending a password to the API. */
export async function prehashPassword(userId: string, password: string): Promise<string> {
    if (!userId) {
        throw new Error(t('api.noUserId'));
    }
    const salted = `${PREHASH_PREFIX}:${userId}:${password}`;
    // crypto.subtle only exists in secure contexts, so a plain-http server has to fall back.
    if (!globalThis.crypto?.subtle) {
        return `${SERVER_SIDE_MARKER}${salted}`;
    }
    try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted));
        return toHex(new Uint8Array(digest)).toLowerCase();
    }
    catch {
        console.warn("crypto.subtle is unavailable in this context, passwords won't be prehashed");
        return `${SERVER_SIDE_MARKER}${salted}`;
    }
}

/** Minimum the server enforces on every password route. Checked client-side for a better message. */
export const MIN_PASSWORD_LENGTH = 8;
