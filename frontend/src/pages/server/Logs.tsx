import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { api } from '@/api/client';

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

/** Live server log viewer with per-type filtering.
 *
 * The legacy Logs tab renders a single pre block with a type dropdown; this keeps the type set as
 * toggleable chips so several streams can be watched at once, and colours each line by its type. */
export function LogsPage() {
    const [selected, setSelected] = useState<string[]>(['Info', 'Warning', 'Error']);
    const [paused, setPaused] = useState(false);
    const [filter, setFilter] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const stickToBottom = useRef(true);

    const logs = useQuery({
        queryKey: ['logs', selected],
        // `last_sequence_ids` must be present: the handler does `(raw["last_sequence_ids"] as
        // JObject).TryGetValue(...)` and would null-deref without it (AdminAPI.cs).
        // An empty map means "send me everything you still have buffered".
        queryFn: () =>
            api.post<LogsResponse>('ListRecentLogMessages', {
                types: selected,
                last_sequence_ids: {}
            }),
        refetchInterval: paused ? false : 3000
    });

    const types = logs.data?.types_available ?? [];

    const lines = useMemo(() => {
        const data = logs.data?.data ?? {};
        const merged = Object.entries(data).flatMap(([type, messages]) =>
            (messages ?? []).map(message => ({ ...message, type }))
        );
        merged.sort((a, b) => a.sequence_id - b.sequence_id);
        const query = filter.trim().toLowerCase();
        return query ? merged.filter(line => line.message.toLowerCase().includes(query)) : merged;
    }, [logs.data, filter]);

    // Follow the tail unless the user has scrolled up to read something.
    useEffect(() => {
        const el = scrollRef.current;
        if (el && stickToBottom.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [lines]);

    const colorFor = (name: string) => types.find(t => t.name === name)?.color ?? 'var(--text-soft)';

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-3 py-2">
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
                                        ? { borderColor: 'transparent', background: 'var(--emphasis)', color: 'var(--emphasis-text)' }
                                        : { borderColor: 'var(--border-color)', color: 'var(--text-soft)' }
                                }
                            >
                                {type.name}
                            </button>
                        );
                    })}
                </div>

                <input
                    type="search"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Filter lines…"
                    aria-label="Filter log lines"
                    className="min-w-40 max-w-xs flex-1 rounded border border-default bg-surface-sunken px-2 py-1 text-sm text-fg outline-none focus:border-[var(--emphasis)]"
                />

                <div className="flex-1" />

                <span className="text-xs text-fg-soft tabular-nums">{lines.length} lines</span>
                <button
                    type="button"
                    onClick={() => setPaused(p => !p)}
                    aria-pressed={paused}
                    className="flex items-center gap-1.5 rounded border border-default px-2 py-1 text-xs text-fg-soft hover:text-fg hover:bg-[var(--sw-hover)]"
                >
                    {paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
                    {paused ? 'Resume' : 'Pause'}
                </button>
            </div>

            <div
                ref={scrollRef}
                onScroll={e => {
                    const el = e.currentTarget;
                    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                }}
                className="min-h-0 flex-1 overflow-auto bg-surface-sunken p-2 font-mono text-[11px] leading-relaxed"
            >
                {selected.length === 0 ? (
                    <p className="p-4 text-center text-fg-soft">Select at least one log type above.</p>
                ) : logs.isPending ? (
                    <p className="p-4 text-center text-fg-soft">Loading logs…</p>
                ) : lines.length === 0 ? (
                    <p className="p-4 text-center text-fg-soft">
                        {filter ? `No lines match "${filter.trim()}".` : 'No log messages yet.'}
                    </p>
                ) : (
                    lines.map(line => (
                        <div key={`${line.type}-${line.sequence_id}`} className="flex gap-2 whitespace-pre-wrap">
                            <span className="shrink-0 text-fg-soft opacity-60">{line.time}</span>
                            <span className="shrink-0" style={{ color: colorFor(line.type) }}>
                                [{line.type}]
                            </span>
                            <span className="min-w-0 break-words text-fg">{line.message}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
