/** Typed client for the Swarm HTTP API.
 *
 * Transport contract (src/WebAPI/API.cs, src/Core/WebServer.cs:283):
 *   - POST JSON to /API/<Call>, or open a WebSocket to the same path.
 *   - Session travels either as `session_id` in the body or an `X-Session-ID` header
 *     (API.cs:104). We use the header so request bodies stay clean.
 *   - Errors come back as { error, error_id } rather than an HTTP status in most cases.
 *   - `invalid_session_id` means the session lapsed; acquire a new one and retry.
 */

import { t } from '@/i18n/store';
import { readCookie, writeCookie } from './cookies';
import type { ApiError, SessionData } from './types';

/** Thrown for any API-level failure. Carries the server's error_id when there was one. */
export class SwarmApiError extends Error {
    readonly errorId?: string;
    readonly route: string;

    constructor(route: string, message: string, errorId?: string) {
        super(message);
        this.name = 'SwarmApiError';
        this.route = route;
        this.errorId = errorId;
    }
}

/** `errorId` on the error a dropped or refused socket raises, as opposed to one the server sent
 *  down the socket. The connection failing says nothing about the work behind it. */
export const SOCKET_FAILED = 'socket_failed';

/** How a stream ended, which is the only way to tell a finished call from a lost connection. */
export interface StreamClose {
    /** True when this client closed the socket (the disposer ran), rather than the far end. */
    local: boolean;
    /** False when the socket never connected at all, so the call never reached the server. */
    opened: boolean;
    /** WebSocket close code; 1000 is a clean close, 1006 an abnormal one. */
    code: number;
    reason: string;
}

const SESSION_COOKIE = 'session_id';
/** Retry ceiling, so a broken session can't loop forever. */
const MAX_RETRY_DEPTH = 3;
/** Set in sessionStorage once the server has been seen installed, so the probe runs once per tab. */
const INSTALLED_KEY = 'swarm-ui-installed';
/** Text only the installer page renders; the installed server's /Install is a bare redirect script
 *  (src/Pages/Install.cshtml). Probing for the installer rather than for the redirect means a markup
 *  change can only cost the redirect, never send an installed server to the installer. */
const INSTALLER_MARKER = '<h1>SwarmUI Installer</h1>';

/** The user an admin asked to act as via `?impersonate=`, read once at load. The router may drop
 *  unknown search params on navigation, and a later session refresh must still ask for the same
 *  user (legacy reads it once too, site.js `impersonateTargetUserId`). */
function readImpersonateTarget(): string | null {
    return new URLSearchParams(window.location.search).get('impersonate')?.trim() || null;
}

/** The login page, set to come back to the current /ui location once signed in. */
function loginPath(): string {
    return `/Login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/** Leaves the app for a server-rendered page (login, installer). Never resolves, so whatever was
 *  waiting on the session keeps showing its loading state until the browser navigates away. */
function leaveFor(path: string): Promise<never> {
    window.location.href = path;
    return new Promise<never>(() => {});
}

/** Holds the active session and serializes concurrent attempts to establish one. */
class SessionStore {
    private current: SessionData | null = null;
    private pending: Promise<SessionData> | null = null;
    /** Cleared when the server refuses the impersonation, so the fallback session sticks. */
    impersonateTarget: string | null = readImpersonateTarget();

    get data(): SessionData | null {
        return this.current;
    }

    get id(): string | null {
        return this.current?.session_id ?? readCookie(SESSION_COOKIE);
    }

    /** Acquires a session, reusing an in-flight request if one is already running. */
    async acquire(client: SwarmApiClient, force = false): Promise<SessionData> {
        if (this.current && !force) {
            return this.current;
        }
        // Collapse concurrent callers onto one GetNewSession request.
        this.pending ??= this.request(client).finally(() => {
            this.pending = null;
        });
        return this.pending;
    }

    private async request(client: SwarmApiClient): Promise<SessionData> {
        const body: Record<string, unknown> = {};
        if (this.impersonateTarget) {
            body.impersonateUser = this.impersonateTarget;
        }
        let data: SessionData;
        try {
            data = await client.rawPost<SessionData>('GetNewSession', body);
        }
        catch (e) {
            // An invalid impersonation target must not lock the user out; drop it and retry once.
            if (e instanceof SwarmApiError && e.errorId === 'bad_impersonate') {
                this.impersonateTarget = null;
                data = await client.rawPost<SessionData>('GetNewSession', {});
            }
            // GetNewSession's only error without an id is "no valid login" (BasicAPIFeatures.cs,
            // GetNewSession), which is what the legacy page redirects to /Login for
            // (Text2Image.cshtml). `return` brings the user back here afterwards (loginpage.js).
            else if (e instanceof SwarmApiError && !e.errorId) {
                return leaveFor(loginPath());
            }
            else {
                throw e;
            }
        }
        this.current = data;
        writeCookie(SESSION_COOKIE, data.session_id, 31);
        return data;
    }

    clear(): void {
        this.current = null;
    }
}

/** True when the server has not been through its installer yet, which is where the legacy page
 *  sends every visit (Text2Image.cshtml). No API exposes `IsInstalled` (it is a hidden setting),
 *  so this reads the installer page itself; any failure counts as installed. */
async function needsInstall(): Promise<boolean> {
    if (sessionStorage.getItem(INSTALLED_KEY)) {
        return false;
    }
    try {
        const response = await fetch('/Install', { credentials: 'same-origin' });
        const html = response.ok ? await response.text() : '';
        if (html.includes(INSTALLER_MARKER)) {
            return true;
        }
        sessionStorage.setItem(INSTALLED_KEY, 'true');
    }
    catch {
        // Unknown is not "not installed"; the session request will report a dead server anyway.
    }
    return false;
}

export class SwarmApiClient {
    private readonly session = new SessionStore();
    /** Notified when the server reports a different build than the one we loaded against. */
    onServerVersionChanged?: (previous: string, current: string) => void;
    /** Notified whenever a new session is established, so cached session data can follow it. */
    onSessionChanged?: (data: SessionData) => void;
    private knownVersion: string | null = null;

    get sessionData(): SessionData | null {
        return this.session.data;
    }

    get permissions(): string[] {
        return this.session.data?.permissions ?? [];
    }

    /** The user being impersonated, once the server has accepted it; null otherwise. */
    get impersonating(): string | null {
        const target = this.session.impersonateTarget;
        return target && this.session.data?.user_id === target ? target : null;
    }

    hasPermission(perm: string): boolean {
        return this.permissions.includes(perm);
    }

    /** Establishes (or refreshes) the session. Call once at startup. */
    async connect(): Promise<SessionData> {
        const [data, install] = await Promise.all([this.session.acquire(this), needsInstall()]);
        if (install) {
            return leaveFor('/Install');
        }
        this.checkVersion(data.version);
        return data;
    }

    /** Replaces a session the server refused. Only the first caller to notice a given id lapsing
     *  makes a new one: anyone else who sent the same stale id finds it already replaced (or being
     *  replaced, which `acquire` collapses onto) and just retries with the new one. */
    private async refreshSession(staleId: string | null): Promise<SessionData> {
        if (this.session.data && this.session.data.session_id !== staleId) {
            return this.session.data;
        }
        this.session.clear();
        const data = await this.session.acquire(this, true);
        this.checkVersion(data.version);
        this.onSessionChanged?.(data);
        return data;
    }

    private checkVersion(version: string): void {
        if (this.knownVersion === null) {
            this.knownVersion = version;
        }
        else if (this.knownVersion !== version) {
            this.onServerVersionChanged?.(this.knownVersion, version);
            this.knownVersion = version;
        }
    }

    /** Ends the login behind this browser (every session it opened, BasicAPIFeatures.Logout) and
     *  goes to the login page, as the legacy account tab does (usertab.js doUserLogout). */
    async logout(): Promise<void> {
        await this.post('Logout');
        this.session.clear();
        writeCookie(SESSION_COOKIE, '', -1);
        await leaveFor(loginPath());
    }

    /** Drops `?impersonate=` and reloads as the admin's own account (site.js stopImpersonatingUser).
     *  The impersonated session's cookie goes too, or the reload would pick it straight back up. */
    stopImpersonating(): void {
        writeCookie(SESSION_COOKIE, '', -1);
        const url = new URL(window.location.href);
        url.searchParams.delete('impersonate');
        window.location.href = url.toString();
    }

    /** POST without session handling or retry. Used to bootstrap the session itself. */
    async rawPost<T>(route: string, body: Record<string, unknown>, sessionId?: string): Promise<T> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (sessionId) {
            headers['X-Session-ID'] = sessionId;
        }
        const response = await fetch(`/API/${route}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
        let payload: (T & ApiError) | null = null;
        try {
            payload = (await response.json()) as T & ApiError;
        }
        catch {
            // Tagged, so a proxy's error page is never mistaken for an error the server sent.
            throw new SwarmApiError(route, t('api.unreadableResponse', { status: response.status }), 'unreadable_response');
        }
        if (payload === null) {
            throw new SwarmApiError(route, t('api.emptyResponse'), 'empty_response');
        }
        if (payload.error || payload.error_id) {
            const message = payload.error ?? t('api.requestFailed', { id: payload.error_id ?? '' });
            throw new SwarmApiError(route, message, payload.error_id);
        }
        return payload;
    }

    /** Calls an API route, acquiring/refreshing the session as needed. */
    async post<T>(route: string, body: Record<string, unknown> = {}, depth = 0): Promise<T> {
        const sessionId = this.session.id ?? (await this.connect()).session_id;
        try {
            return await this.rawPost<T>(route, body, sessionId);
        }
        catch (e) {
            if (e instanceof SwarmApiError && e.errorId === 'invalid_session_id' && depth < MAX_RETRY_DEPTH) {
                await this.refreshSession(sessionId);
                return this.post<T>(route, body, depth + 1);
            }
            throw e;
        }
    }

    /** WebSocket URL for a route, honoring https → wss. */
    private wsUrl(route: string): string {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/API/${route}`;
    }

    /** Opens a streaming API call. Messages arrive via `onMessage` until the socket closes.
     *  Returns a disposer that closes the socket. */
    stream<T>(
        route: string,
        body: Record<string, unknown>,
        handlers: {
            onMessage: (data: T) => void;
            onError?: (error: SwarmApiError) => void;
            onClose?: (info: StreamClose) => void;
        }
    ): () => void {
        let local = false;
        let current: WebSocket | null = null;

        const open = (depth: number): void => {
            let opened = false;
            /** Set once this socket's ending has been accounted for, whether that was by reporting
             *  it to the caller or by replacing the socket ourselves. */
            let settled = false;
            const socket = new WebSocket(this.wsUrl(route));
            current = socket;

            /** The session this socket was opened with, so a refusal replaces that one only. */
            let sentId: string | null = null;
            socket.onopen = () => {
                opened = true;
                sentId = this.session.id;
                socket.send(JSON.stringify({ ...body, session_id: sentId }));
            };
            socket.onmessage = event => {
                let data: T & ApiError;
                try {
                    data = JSON.parse(event.data) as T & ApiError;
                }
                catch {
                    // One unreadable frame is not worth tearing the stream down over.
                    console.warn(`[api] Unreadable message on ${route} stream`);
                    return;
                }
                // A lapsed session (a server restart is the usual cause) is refused before the
                // route runs at all (API.cs:114), so nothing was started and reconnecting with a
                // fresh session is invisible to the caller - and far better than reporting a
                // failure the user can only fix by reloading the page.
                if (data.error_id === 'invalid_session_id' && !local && depth < MAX_RETRY_DEPTH) {
                    settled = true;
                    socket.close();
                    this.refreshSession(sentId)
                        .then(() => {
                            // Disposed while we were fetching a session: the caller is owed the
                            // close it would have got had the socket still been open.
                            if (local) {
                                handlers.onClose?.({ local: true, opened, code: 1000, reason: '' });
                                return;
                            }
                            open(depth + 1);
                        })
                        .catch(() => {
                            handlers.onError?.(new SwarmApiError(route, t('api.socketFailed'), SOCKET_FAILED));
                            handlers.onClose?.({ local: false, opened: false, code: 1006, reason: '' });
                        });
                    return;
                }
                if (data.error || data.error_id) {
                    const message = data.error ?? t('api.streamFailed', { id: data.error_id ?? '' });
                    handlers.onError?.(new SwarmApiError(route, message, data.error_id));
                    return;
                }
                handlers.onMessage(data);
            };
            // A transport-level failure is not a failure of whatever the stream was doing - the
            // work may well be continuing on the server - so it is tagged for callers that care,
            // and always followed by `onclose`, which is where the caller decides what it meant.
            socket.onerror = () => {
                if (!local && !settled) {
                    handlers.onError?.(new SwarmApiError(route, t('api.socketFailed'), SOCKET_FAILED));
                }
            };
            socket.onclose = event => {
                if (settled) {
                    return;
                }
                settled = true;
                handlers.onClose?.({ local, opened, code: event.code, reason: event.reason });
            };
        };

        open(0);

        return () => {
            local = true;
            const socket = current;
            if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                socket.close();
            }
        };
    }
}

/** Shared client instance. */
export const api = new SwarmApiClient();
