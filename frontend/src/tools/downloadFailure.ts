/** Reading a failed download's error message well enough to say what to do about it.
 *
 * The server reports these as one readable sentence carrying both the URL and the upstream status
 * (`Failed to download <url>: got response code 403 Forbidden`, Utilities.cs:728), and that is all
 * that reaches the browser — there is no structured failure to inspect. So the message is parsed
 * back apart here, because 401 and 403 from a model host are almost never a broken link: they mean
 * the file needs an account, and the user has somewhere specific to go.
 */

/** Hosts whose refusals have a known remedy. */
export type FailureHost = 'huggingface' | 'civitai' | 'other';

export interface DownloadAuthFailure {
    /** Status the host answered with, when the message named one. */
    status: number | null;
    host: FailureHost;
    /** File URL that was refused, when the message named one. */
    url: string | null;
    /** Page where access is granted — the repo's own page, which is where a gated Hugging Face
     *  repo shows its "accept the conditions" button. Null when it cannot be derived. */
    modelPage: string | null;
}

/** Both wordings Utilities.cs produces, with the parenthetical of the resume-download variant
 *  ('(expecting Partial range continue)') skipped over. */
const FAILED_DOWNLOAD = /Failed to download (.+?)(?: \([^)]*\))?: got response code (\d{3})/;
/** Statuses that mean "not you, or not yet" rather than "no such file". */
const AUTH_STATUSES = [401, 403];

function hostOf(url: URL): FailureHost {
    const host = url.hostname.toLowerCase();
    if (host === 'huggingface.co' || host.endsWith('.huggingface.co')) {
        return 'huggingface';
    }
    // The server rewrites civitai.com and civitai.green to civitai.red before downloading
    // (ModelsAPI.cs:609), so the failure can name any of the three.
    if (/(^|\.)civitai\.(com|red|green)$/.test(host)) {
        return 'civitai';
    }
    return 'other';
}

/** The repo's landing page for a Hugging Face file URL: everything before /resolve/ or /blob/.
 *  Datasets and Spaces carry their kind as a first segment, which stays part of the path. */
function huggingFacePage(url: URL): string | null {
    const parts = url.pathname.split('/').filter(Boolean);
    const cut = parts.findIndex(part => part === 'resolve' || part === 'blob');
    const repo = cut === -1 ? parts : parts.slice(0, cut);
    if (repo.length < 2) {
        return null;
    }
    return `https://huggingface.co/${repo.join('/')}`;
}

/** Describes an authorization failure behind a job error, or null if it was some other failure. */
export function readDownloadAuthFailure(error: string | undefined | null): DownloadAuthFailure | null {
    if (!error) {
        return null;
    }
    const match = FAILED_DOWNLOAD.exec(error);
    if (!match) {
        // Some failures arrive without the URL — a proxy's own wording, say. The advice still holds
        // if the status is one of the two that mean "credentials".
        const loose = /\b(401|403)\b|\bUnauthorized\b|\bForbidden\b/i.exec(error);
        if (!loose) {
            return null;
        }
        const status = Number(loose[1]);
        return { status: Number.isFinite(status) ? status : null, host: 'other', url: null, modelPage: null };
    }
    const status = Number(match[2]);
    if (!AUTH_STATUSES.includes(status)) {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(match[1]);
    } catch {
        return { status, host: 'other', url: null, modelPage: null };
    }
    const host = hostOf(parsed);
    return {
        status,
        host,
        url: parsed.toString(),
        modelPage: host === 'huggingface' ? huggingFacePage(parsed) : null
    };
}
