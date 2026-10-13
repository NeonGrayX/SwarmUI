import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, Pause, Play, Upload, X } from 'lucide-react';
import { api } from '@/api/client';
import { queryKeys } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { REMOTE_SWARM_TYPE, type Backend } from '@/server/backends';
import { useTranslation } from '@/i18n';

interface LogType {
    /** The key used everywhere: request `types`, the `data` map, and `last_sequence_ids`. */
    name: string;
    color: string;
    /** Only set for extension-registered trackers; empty for the six built-in levels
     *  (Logs.OtherTrackers is keyed by level name, src/Utils/Logs.cs:216). Do not key off this. */
    identifier: string;
}

interface LogMessage {
    sequence_id: number;
    time: string;
    message: string;
}

interface LogsResponse {
    types_available: LogType[];
    data: Record<string, LogMessage[]>;
    last_sequence_id: number;
}

/** A message once it is in the buffer, tagged with the tracker it came from. */
interface StreamLine extends LogMessage {
    type: string;
}

/** How much scrollback to keep. The server only buffers 1024 messages per tracker
 *  (Logs.LogTracker.MaxTracked), so this holds rather more than one poll can ever return. */
const MAX_BUFFERED_LINES = 5000;

/** How long typing in the filter box settles before the buffer is re-filtered. */
const FILTER_DEBOUNCE_MS = 200;

/** One server's scrollback, plus where each of its trackers was read up to. */
interface SourceBuffer {
    /** Highest sequence id seen per tracker, sent back as `last_sequence_ids` so each poll returns
     *  only what is new. Without it every poll re-sends the server's whole 1024-message buffer for
     *  every selected type, which is merely wasteful locally and a real cost over a remote link. */
    cursors: Record<string, number>;
    /** Sorted by sequence id. Mutated in place; a version counter tells React it changed. */
    lines: StreamLine[];
}

/** Folds a poll's result into a buffer. Anything at or below the tracker's cursor has been taken
 *  already, which also makes an overlapping or replayed poll harmless. Usually everything new sorts
 *  after the tail and is simply appended; a newly selected type's history is merged in instead.
 *  Returns whether anything was added. */
function mergeIntoBuffer(buffer: SourceBuffer, data: LogsResponse): boolean {
    const fresh: StreamLine[] = [];
    for (const [type, messages] of Object.entries(data.data ?? {})) {
        for (const message of messages ?? []) {
            const cursor = buffer.cursors[type] ?? -1;
            if (message.sequence_id <= cursor) {
                continue;
            }
            fresh.push({ ...message, type });
        }
        for (const message of messages ?? []) {
            buffer.cursors[type] = Math.max(buffer.cursors[type] ?? -1, message.sequence_id);
        }
    }
    if (fresh.length === 0) {
        return false;
    }
    fresh.sort((a, b) => a.sequence_id - b.sequence_id);
    const lines = buffer.lines;
    if (lines.length === 0 || fresh[0].sequence_id >= lines[lines.length - 1].sequence_id) {
        for (const line of fresh) {
            lines.push(line);
        }
    }
    else {
        const merged: StreamLine[] = [];
        let i = 0;
        let j = 0;
        while (i < lines.length || j < fresh.length) {
            if (j >= fresh.length || (i < lines.length && lines[i].sequence_id <= fresh[j].sequence_id)) {
                merged.push(lines[i++]);
            }
            else {
                merged.push(fresh[j++]);
            }
        }
        buffer.lines = merged;
    }
    if (buffer.lines.length > MAX_BUFFERED_LINES) {
        buffer.lines.splice(0, buffer.lines.length - MAX_BUFFERED_LINES);
    }
    return true;
}

/** Live server log viewer. Types are toggleable chips rather than a single choice, so several
 *  streams can be watched at once, and each line is coloured by its type.
 *
 *  Logs can come from this server or, through the RemoteLogs proxy, from a Swarm running as a
 *  backend elsewhere — that machine's own logs are otherwise unreachable from here. */
export function LogsPage() {
    const { t, tDynamic } = useTranslation();
    // ?types=<name> deep-links a single tracker, which is how a backend card opens its own process
    // log. The default set is the built-in severity levels (Logs.cs:216 keys those by level name).
    // ?backend=<id> points the whole viewer at a remote Swarm instead of this server.
    const search = useSearch({ strict: false }) as { types?: string; backend?: number };
    const navigate = useNavigate();
    // Which server is being read, as a backend id, or null for this one. Held in the URL rather
    // than in state so the source is deep-linkable and survives the back button. Kept as a string
    // from here on: it is only ever compared against other ids and sent to the API.
    const source = search.backend === undefined ? null : String(search.backend);
    const [selected, setSelected] = useState<string[]>(
        search.types ? search.types.split(',') : ['Info', 'Warning', 'Error']
    );
    const [paused, setPaused] = useState(false);
    const [pastebinOpen, setPastebinOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [appliedFilter, setAppliedFilter] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setAppliedFilter(filter), FILTER_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [filter]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const stickToBottom = useRef(true);
    /** Scrollback and cursors per source ('' for this server). Sequence ids are per-server
     *  (Logs.LogTracker.LastSequenceID is one static counter per process), so each source keeps its
     *  own: switching away and back resumes where it was, and a poll still in flight for the source
     *  just left lands in that source's buffer rather than the one now on screen. */
    const buffers = useRef(new Map<string, SourceBuffer>());
    const [version, setVersion] = useState(0);
    const sourceKey = source ?? '';
    function bufferFor(key: string): SourceBuffer {
        let buffer = buffers.current.get(key);
        if (!buffer) {
            buffer = { cursors: {}, lines: [] };
            buffers.current.set(key, buffer);
        }
        return buffer;
    }

    // Offering a source picker at all needs the backend list; reading the logs themselves does not.
    const canListBackends = usePermission('view_backends_list');
    const backends = useQuery({
        // The key carries the request body, so this never shares an entry with the Backends page's
        // full_data list. Invalidating there still reaches this one, since keys match by prefix.
        queryKey: queryKeys.backends(false),
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', { full_data: false }),
        enabled: canListBackends,
        refetchInterval: 30000
    });
    // A disabled remote is left out: there is no connection behind it to ask through, and the
    // proxy would only refuse (RemoteLogs.Forward).
    const remotes = useMemo(
        () =>
            Object.values(backends.data ?? {}).filter(
                backend => backend.type === REMOTE_SWARM_TYPE && backend.status !== 'disabled'
            ),
        [backends.data]
    );

    const logs = useQuery({
        queryKey: ['logs', source, selected],
        // `last_sequence_ids` must be present: the handler does `(raw["last_sequence_ids"] as
        // JObject).TryGetValue(...)` and would null-deref without it (AdminAPI.cs).
        // An empty map means "send me everything you still have buffered".
        queryFn: async () => {
            const buffer = bufferFor(sourceKey);
            const lastIds = { ...buffer.cursors };
            const data =
                source === null
                    ? await api.post<LogsResponse>('ListRecentLogMessages', {
                          types: selected,
                          last_sequence_ids: lastIds
                      })
                    : await api.post<LogsResponse>('ListRemoteLogMessages', {
                          backend_id: source,
                          types: selected,
                          last_sequence_ids: lastIds
                      });
            if (mergeIntoBuffer(buffer, data)) {
                setVersion(v => v + 1);
            }
            return data;
        },
        refetchInterval: paused ? false : 3000
    });

    // Follow later deep links too: clicking a second backend's log button while already here
    // changes the search param but would otherwise leave the first backend's selection in place.
    useEffect(() => {
        if (search.types) {
            setSelected(search.types.split(','));
        }
    }, [search.types]);

    const types = logs.data?.types_available ?? [];
    const streamLength = buffers.current.get(sourceKey)?.lines.length ?? 0;

    // Deselecting a type hides its lines without dropping them: the buffer keeps them, and its
    // cursor keeps its place, so re-selecting shows the history back again instead of re-pulling it.
    // Recomputed only when a poll actually brought something new, not on every poll.
    const lines = useMemo(() => {
        const query = appliedFilter.trim().toLowerCase();
        const wanted = new Set(selected);
        return (buffers.current.get(sourceKey)?.lines ?? []).filter(
            line => wanted.has(line.type) && (query === '' || line.message.toLowerCase().includes(query))
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the buffer's change signal
    }, [version, sourceKey, selected, appliedFilter]);

    const colorFor = (name: string) => types.find(t => t.name === name)?.color ?? 'var(--sw-fg-soft)';
    const sourceLabel = (backend: Backend) =>
        `${backend.title || t('logs.remoteFallbackName')} (#${backend.id})`;
    // Named for the pastebin dialog, which says whose logs are about to be made public. A deep
    // link to a backend missing from the list still gets its id rather than no name at all.
    const remoteName = useMemo(() => {
        if (source === null) {
            return null;
        }
        const backend = remotes.find(b => String(b.id) === source);
        return backend ? sourceLabel(backend) : `#${source}`;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceLabel is re-made each render
    }, [source, remotes, t]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-3 py-2">
                {/* Only worth showing when there is somewhere else to look. A deep link to a
                    backend that is gone from the list still gets an entry, or the picker would
                    read as "this server" while remote logs are on screen. */}
                {(remotes.length > 0 || source !== null) && (
                    <select
                        value={source ?? ''}
                        aria-label={t('logs.source')}
                        onChange={e =>
                            navigate({
                                to: '/server/logs',
                                search: e.target.value ? { backend: Number(e.target.value) } : {}
                            })
                        }
                        className="rounded border border-default bg-surface-sunken px-2 py-1 text-xs text-fg outline-none focus:border-[var(--emphasis)]"
                    >
                        <option value="">{t('logs.sourceLocal')}</option>
                        {remotes.map(backend => (
                            <option key={backend.id} value={String(backend.id)}>
                                {sourceLabel(backend)}
                            </option>
                        ))}
                        {source !== null && !remotes.some(b => String(b.id) === source) && (
                            <option value={source}>{`#${source}`}</option>
                        )}
                    </select>
                )}

                <div className="flex flex-wrap gap-1">
                    {types.map(type => {
                        const active = selected.includes(type.name);
                        return (
                            <button
                                key={type.name}
                                type="button"
                                aria-pressed={active}
                                onClick={() =>
                                    setSelected(list =>
                                        active ? list.filter(t => t !== type.name) : [...list, type.name]
                                    )
                                }
                                className="rounded-full border px-2 py-0.5 text-xs transition-colors"
                                style={
                                    active
                                        ? { borderColor: 'transparent', background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }
                                        : { borderColor: 'var(--border-color)', color: 'var(--sw-fg-soft)' }
                                }
                            >
                                {tDynamic(type.name)}
                            </button>
                        );
                    })}
                </div>

                <input
                    type="search"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder={t('logs.filterPlaceholder')}
                    aria-label={t('logs.filterLabel')}
                    className="min-w-40 max-w-xs flex-1 rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />

                <div className="flex-1" />

                <span className="text-xs text-fg-soft tabular-nums">
                    {t('logs.lineCount', { count: lines.length })}
                </span>
                {/* LogSubmitToPastebin only ever reads the trackers of the server it runs on, so
                    for a remote source the submit is forwarded and the paste made over there. */}
                <button
                    type="button"
                    onClick={() => setPastebinOpen(true)}
                    className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    <Upload size={12} aria-hidden />
                    {t('logs.pastebin')}
                </button>
                <button
                    type="button"
                    onClick={() => setPaused(p => !p)}
                    aria-pressed={paused}
                    className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    {paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
                    {paused ? t('logs.resume') : t('logs.pause')}
                </button>
            </div>

            {logs.error && (
                <p
                    className="shrink-0 border-b border-subtle px-3 py-2 text-xs"
                    style={{ color: 'var(--danger-button-background)' }}
                >
                    {t('logs.loadFailed', {
                        error: logs.error instanceof Error ? logs.error.message : String(logs.error)
                    })}
                </p>
            )}

            <div
                ref={scrollRef}
                onScroll={e => {
                    const el = e.currentTarget;
                    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                }}
                className="min-h-0 flex-1 overflow-auto bg-surface-sunken p-2 font-mono text-[11px] leading-relaxed"
            >
                {selected.length === 0 ? (
                    <p className="p-4 text-center text-fg-soft">{t('logs.selectType')}</p>
                ) : logs.isPending && streamLength === 0 ? (
                    <p className="p-4 text-center text-fg-soft">{t('logs.loading')}</p>
                ) : lines.length === 0 ? (
                    <p className="p-4 text-center text-fg-soft">
                        {filter ? t('logs.noMatches', { filter: filter.trim() }) : t('logs.noMessages')}
                    </p>
                ) : (
                    <WindowedLines
                        items={lines}
                        scrollRef={scrollRef}
                        stickToBottom={stickToBottom}
                        itemKey={lineKey}
                        renderItem={line => (
                            <div className="flex gap-2 whitespace-pre-wrap">
                                <span className="shrink-0 text-fg-soft opacity-60">{line.time}</span>
                                <span className="shrink-0" style={{ color: colorFor(line.type) }}>
                                    [{tDynamic(line.type)}]
                                </span>
                                <span className="min-w-0 break-words text-fg">{line.message}</span>
                            </div>
                        )}
                    />
                )}
            </div>

            {/* Mounted only while open so a second visit starts from the warnings, not the
                previous run's result. */}
            {pastebinOpen && (
                <PastebinDialog source={source} sourceName={remoteName} onOpenChange={setPastebinOpen} />
            )}
        </div>
    );
}

/** Stable row key; sequence ids are unique per server, the type only guards against a message
 *  that somehow sits in two trackers. */
function lineKey(line: StreamLine): string {
    return `${line.type}-${line.sequence_id}`;
}

/** Assumed height of a row not yet measured; one line of 11px text at relaxed leading. */
const ESTIMATED_ROW_HEIGHT = 18;
/** Pixels rendered beyond each edge of the viewport, so a fast scroll does not show blank space. */
const OVERSCAN_PX = 600;

/** Renders only the rows near the viewport of `scrollRef`, with spacers standing in for the rest.
 *  Rows wrap, so heights vary: each rendered row is measured and the measurement kept by key, with
 *  an estimate for rows never seen. A width change drops every measurement, since wrapping moves.
 *  Also keeps the view pinned to the tail while `stickToBottom` is set. */
function WindowedLines<T>(props: {
    items: T[];
    itemKey: (item: T) => string;
    renderItem: (item: T) => ReactNode;
    scrollRef: RefObject<HTMLDivElement | null>;
    stickToBottom: RefObject<boolean>;
}) {
    const { items, itemKey, scrollRef, stickToBottom } = props;
    const heights = useRef(new Map<string, number>());
    const rowRefs = useRef(new Map<string, HTMLDivElement>());
    const [viewport, setViewport] = useState({ top: 0, height: 600 });
    const [measured, setMeasured] = useState(0);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        let width = el.clientWidth;
        const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
        const observer = new ResizeObserver(() => {
            if (el.clientWidth !== width) {
                width = el.clientWidth;
                heights.current.clear();
            }
            update();
        });
        observer.observe(el);
        el.addEventListener('scroll', update, { passive: true });
        update();
        return () => {
            observer.disconnect();
            el.removeEventListener('scroll', update);
        };
    }, [scrollRef]);

    // Prefix sums of row heights; tops[i] is where row i starts and tops[n] the total height.
    const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
    const tops = useMemo(() => {
        const result = new Array<number>(keys.length + 1);
        result[0] = 0;
        for (let i = 0; i < keys.length; i++) {
            result[i + 1] = result[i] + (heights.current.get(keys[i]) ?? ESTIMATED_ROW_HEIGHT);
        }
        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- measured is the heights' change signal
    }, [keys, measured]);

    /** First row whose bottom edge is below `y`. */
    function rowAt(y: number): number {
        let low = 0;
        let high = keys.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (tops[mid + 1] <= y) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        return low;
    }

    const total = tops[keys.length];
    // While pinned to the tail, window off the bottom rather than the last scroll position, which
    // is stale until the scroll below lands.
    const top = stickToBottom.current ? Math.max(0, total - viewport.height) : viewport.top;
    const start = rowAt(Math.max(0, top - OVERSCAN_PX));
    const end = Math.min(keys.length, rowAt(top + viewport.height + OVERSCAN_PX) + 1);

    useLayoutEffect(() => {
        let changed = false;
        for (const [key, el] of rowRefs.current) {
            const height = el.offsetHeight;
            if (height > 0 && heights.current.get(key) !== height) {
                heights.current.set(key, height);
                changed = true;
            }
        }
        if (changed) {
            setMeasured(m => m + 1);
        }
        const el = scrollRef.current;
        if (el && stickToBottom.current) {
            el.scrollTop = el.scrollHeight;
        }
    });

    const rendered: ReactNode[] = [];
    for (let i = start; i < end; i++) {
        const key = keys[i];
        rendered.push(
            <div
                key={key}
                ref={el => {
                    if (el) {
                        rowRefs.current.set(key, el);
                    }
                    else {
                        rowRefs.current.delete(key);
                    }
                }}
            >
                {props.renderItem(items[i])}
            </div>
        );
    }

    return (
        <div style={{ height: total, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: tops[start] }}>{rendered}</div>
        </div>
    );
}

/** Minimum levels the pastebin API accepts. Everything at or above the chosen level is included
 *  (AdminAPI.LogSubmitToPastebin walks Logs.Trackers from the level index upward). */
const PASTEBIN_LEVELS = ['verbose', 'debug', 'info'];

const PASTE_SERVICE = 'https://paste.denizenscript.com/New/Swarm';

/** One-click upload of the server log to the public Swarm pastebin, for sharing when asking for
 *  support. The paste is public and not easily deletable, so the warning is shown before the
 *  submit rather than after.
 *
 *  `source` is the backend id whose logs are on screen, or null for this server. A remote's logs
 *  are pasted by the remote itself (RemoteLogs.RemoteLogSubmitToPastebin forwards the call), so
 *  the resulting URL is the same kind of link either way. */
function PastebinDialog(props: {
    source: string | null;
    sourceName: string | null;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const [level, setLevel] = useState('debug');
    const [copied, setCopied] = useState(false);
    const source = props.source;

    const submit = useMutation({
        mutationFn: (type: string) =>
            source === null
                ? api.post<{ url: string }>('LogSubmitToPastebin', { type })
                : api.post<{ url: string }>('RemoteLogSubmitToPastebin', { backend_id: source, type })
    });

    const url = submit.data?.url;

    return (
        <Dialog.Root open onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <Dialog.Content className="fixed left-1/2 top-1/4 z-50 w-[min(34rem,90vw)] -translate-x-1/2 rounded-lg border border-default bg-surface-raised p-4 shadow-2xl">
                    <div className="mb-3 flex items-center gap-2">
                        <Upload size={16} className="text-fg-soft" aria-hidden />
                        <Dialog.Title className="flex-1 text-base font-medium text-fg-strong">
                            {t('logs.pastebinTitle')}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={t('common.close')}
                                className="rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                            >
                                <X size={15} aria-hidden />
                            </button>
                        </Dialog.Close>
                    </div>

                    <Dialog.Description asChild>
                        <div className="mb-3 space-y-2 text-sm text-fg-soft">
                            <p>
                                {t('logs.pastebinIntro1')}{' '}
                                <a
                                    href={PASTE_SERVICE}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                    style={{ color: 'var(--emphasis)' }}
                                >
                                    {t('logs.pastebinServiceLink')}
                                </a>
                                {t('logs.pastebinIntro2')}{' '}
                                <a
                                    href="https://discord.gg/q2y38cqjNw"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                    style={{ color: 'var(--emphasis)' }}
                                >
                                    {t('logs.pastebinDiscordLink')}
                                </a>
                                {t('logs.pastebinIntro3')}
                            </p>
                            {props.sourceName !== null && (
                                <p className="text-fg">
                                    {t('logs.pastebinRemoteNote', { source: props.sourceName })}
                                </p>
                            )}
                            <p className="text-fg">{t('logs.pastebinWarning')}</p>
                            <p>
                                {t('logs.pastebinManual1')}{' '}
                                <a
                                    href={PASTE_SERVICE}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                    style={{ color: 'var(--emphasis)' }}
                                >
                                    {t('logs.pastebinManualLink')}
                                </a>{' '}
                                {t('logs.pastebinManual2')}
                            </p>
                        </div>
                    </Dialog.Description>

                    <label className="mb-4 flex items-center gap-2 text-sm text-fg">
                        {t('logs.minimumLevel')}
                        <select
                            value={level}
                            disabled={submit.isPending || Boolean(url)}
                            onChange={e => setLevel(e.target.value)}
                            className="rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)] disabled:opacity-50"
                        >
                            {PASTEBIN_LEVELS.map(option => (
                                <option key={option} value={option}>
                                    {t(`logs.level.${option}`)}
                                </option>
                            ))}
                        </select>
                    </label>

                    {url && (
                        <div className="mb-4 rounded border border-subtle bg-surface-sunken p-2 text-sm">
                            <div className="flex items-center gap-2">
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 flex-1 break-all underline"
                                    style={{ color: 'var(--emphasis)' }}
                                >
                                    {url}
                                </a>
                                <button
                                    type="button"
                                    aria-label={t('logs.copyPasteUrl')}
                                    title={t('logs.copyPasteUrl')}
                                    onClick={() => {
                                        navigator.clipboard.writeText(url).then(
                                            () => {
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 1500);
                                            },
                                            () => setCopied(false)
                                        );
                                    }}
                                    className="shrink-0 rounded p-1 text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                                >
                                    {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                                </button>
                            </div>
                            <p className="mt-1 text-xs text-fg-soft">{t('logs.pastebinShareHint')}</p>
                        </div>
                    )}

                    {submit.error && (
                        <p className="mb-4 text-sm" style={{ color: 'var(--danger-button-background)' }}>
                            {t('logs.submitFailed', { error: submit.error.message })}
                        </p>
                    )}

                    <div className="flex justify-end gap-2">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded border border-default px-3 py-1.5 text-sm text-fg hover:bg-[var(--sw-hover)]"
                            >
                                {url ? t('common.close') : t('common.cancel')}
                            </button>
                        </Dialog.Close>
                        {!url && (
                            <button
                                type="button"
                                disabled={submit.isPending}
                                onClick={() => submit.mutate(level)}
                                className="rounded px-3 py-1.5 text-sm disabled:opacity-60"
                                style={{ background: 'var(--emphasis)', color: 'var(--sw-accent-fg)' }}
                            >
                                {submit.isPending ? t('logs.submitting') : t('logs.submit')}
                            </button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
