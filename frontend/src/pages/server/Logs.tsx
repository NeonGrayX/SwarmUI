import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, Pause, Play, Upload, X } from 'lucide-react';
import { api } from '@/api/client';
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
    const scrollRef = useRef<HTMLDivElement>(null);
    const stickToBottom = useRef(true);
    /** Highest sequence id seen per tracker, sent back as `last_sequence_ids` so each poll returns
     *  only what is new. Without it every poll re-sends the server's whole 1024-message buffer for
     *  every selected type, which is merely wasteful locally and a real cost over a remote link. */
    const cursors = useRef<Record<string, number>>({});
    const [stream, setStream] = useState<StreamLine[]>([]);

    // Offering a source picker at all needs the backend list; reading the logs themselves does not.
    const canListBackends = usePermission('view_backends_list');
    const backends = useQuery({
        // Deliberately not the Backends page's own ['backends'] key: that one is fetched with
        // full_data and the two would overwrite each other's cache entry. Invalidating there still
        // reaches this one, since keys match by prefix.
        queryKey: ['backends', 'log-sources'],
        queryFn: () => api.post<Record<string, Backend>>('ListBackends', {}),
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
        queryFn: () =>
            source === null
                ? api.post<LogsResponse>('ListRecentLogMessages', {
                      types: selected,
                      last_sequence_ids: cursors.current
                  })
                : api.post<LogsResponse>('ListRemoteLogMessages', {
                      backend_id: source,
                      types: selected,
                      last_sequence_ids: cursors.current
                  }),
        refetchInterval: paused ? false : 3000
    });

    // Follow later deep links too: clicking a second backend's log button while already here
    // changes the search param but would otherwise leave the first backend's selection in place.
    useEffect(() => {
        if (search.types) {
            setSelected(search.types.split(','));
        }
    }, [search.types]);

    // Sequence ids are per-server (Logs.LogTracker.LastSequenceID is one static counter per
    // process), so a cursor or a buffered line from one server means nothing on another.
    useEffect(() => {
        cursors.current = {};
        setStream([]);
    }, [source]);

    // Append what the poll returned. Anything at or below the tracker's cursor has been taken
    // already, which also makes a repeated render or a replayed cache entry harmless.
    useEffect(() => {
        if (!logs.data) {
            return;
        }
        const fresh: StreamLine[] = [];
        for (const [type, messages] of Object.entries(logs.data.data ?? {})) {
            for (const message of messages ?? []) {
                if (message.sequence_id <= (cursors.current[type] ?? -1)) {
                    continue;
                }
                cursors.current[type] = message.sequence_id;
                fresh.push({ ...message, type });
            }
        }
        if (fresh.length === 0) {
            return;
        }
        setStream(prev => {
            const next = [...prev, ...fresh].sort((a, b) => a.sequence_id - b.sequence_id);
            return next.length > MAX_BUFFERED_LINES ? next.slice(-MAX_BUFFERED_LINES) : next;
        });
    }, [logs.data]);

    const types = logs.data?.types_available ?? [];

    // Deselecting a type hides its lines without dropping them: the buffer keeps them, and its
    // cursor keeps its place, so re-selecting shows the history back again instead of re-pulling it.
    const lines = useMemo(() => {
        const query = filter.trim().toLowerCase();
        return stream.filter(
            line =>
                selected.includes(line.type) &&
                (query === '' || line.message.toLowerCase().includes(query))
        );
    }, [stream, selected, filter]);

    // Follow the tail unless the user has scrolled up to read something.
    useEffect(() => {
        const el = scrollRef.current;
        if (el && stickToBottom.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [lines]);

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
                ) : logs.isPending && stream.length === 0 ? (
                    <p className="p-4 text-center text-fg-soft">{t('logs.loading')}</p>
                ) : lines.length === 0 ? (
                    <p className="p-4 text-center text-fg-soft">
                        {filter ? t('logs.noMatches', { filter: filter.trim() }) : t('logs.noMessages')}
                    </p>
                ) : (
                    lines.map(line => (
                        <div key={`${line.type}-${line.sequence_id}`} className="flex gap-2 whitespace-pre-wrap">
                            <span className="shrink-0 text-fg-soft opacity-60">{line.time}</span>
                            <span className="shrink-0" style={{ color: colorFor(line.type) }}>
                                [{tDynamic(line.type)}]
                            </span>
                            <span className="min-w-0 break-words text-fg">{line.message}</span>
                        </div>
                    ))
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
