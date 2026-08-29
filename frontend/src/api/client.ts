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

const SESSION_COOKIE = 'session_id';
/** Retry ceiling, so a broken session can't loop forever. */
const MAX_RETRY_DEPTH = 3;

/** Holds the active session and serializes concurrent attempts to establish one. */
class SessionStore {
    private current: SessionData | null = null;
    private pending: Promise<SessionData> | null = null;

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
        const impersonate = new URLSearchParams(window.location.search).get('impersonate')?.trim();
        const body: Record<string, unknown> = {};
        if (impersonate) {
            body.impersonateUser = impersonate;
        }
        let data: SessionData;
        try {
            data = await client.rawPost<SessionData>('GetNewSession', body);
        }
        catch (e) {
            // An invalid impersonation target must not lock the user out; drop it and retry once.
            if (e instanceof SwarmApiError && e.errorId === 'bad_impersonate') {
                data = await client.rawPost<SessionData>('GetNewSession', {});
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

export class SwarmApiClient {
    private readonly session = new SessionStore();
    /** Notified when the server reports a different build than the one we loaded against. */
    onServerVersionChanged?: (previous: string, current: string) => void;
    private knownVersion: string | null = null;

    get sessionData(): SessionData | null {
        return this.session.data;
    }

    get permissions(): string[] {
        return this.session.data?.permissions ?? [];
    }

    hasPermission(perm: string): boolean {
        return this.permissions.includes(perm);
    }

    /** Establishes (or refreshes) the session. Call once at startup. */
    async connect(): Promise<SessionData> {
        const data = await this.session.acquire(this);
        this.checkVersion(data.version);
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
            throw new SwarmApiError(route, t('api.unreadableResponse', { status: response.status }));
        }
        if (payload === null) {
            throw new SwarmApiError(route, t('api.emptyResponse'));
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
                this.session.clear();
                await this.session.acquire(this, true);
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
            onClose?: () => void;
        }
    ): () => void {
        let closed = false;
        const socket = new WebSocket(this.wsUrl(route));

        socket.onopen = () => {
            socket.send(JSON.stringify({ ...body, session_id: this.session.id }));
        };
        socket.onmessage = event => {
            const data = JSON.parse(event.data) as T & ApiError;
            if (data.error || data.error_id) {
                const message = data.error ?? t('api.streamFailed', { id: data.error_id ?? '' });
                handlers.onError?.(new SwarmApiError(route, message, data.error_id));
                return;
            }
            handlers.onMessage(data);
        };
        socket.onerror = () => {
            if (!closed) {
                handlers.onError?.(new SwarmApiError(route, t('api.socketFailed')));
            }
        };
        socket.onclose = () => {
            closed = true;
            handlers.onClose?.();
        };

        return () => {
            closed = true;
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.close();
            }
        };
    }
}

/** Shared client instance. */
export const api = new SwarmApiClient();
